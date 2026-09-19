<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/remote

> Run a Variance Authority renderer or baseline store on the other side of an HTTP hop.

Part of [Variance Authority](https://variance-authority.dev), which retains what
a test run knows — what it rendered, which code it entered, what the workspace
exposes — so the next question is answered from the record, not another run.

## What this is for

Screenshot comparison is only valid between images painted by the same machine
and the same browser build. The usual way to get that is to pin your entire test
pipeline inside one container and pay for it on every job.

This package lets you pin only the part that needs pinning. You run a small HTTP
server on the machine that owns the pixels — or on the machine that owns the
approved images — and everything else runs wherever it is cheapest. The client
half returns the same `Renderer` and `RasterStore` objects the local ones do, so
nothing above or below the hop is written differently.

Two things can move:

| You run | The rest of the pipeline gets |
| --- | --- |
| `serveRenderer` on a box with a pinned browser | a renderer that paints on that box |
| `serveRasterStore` in front of your baseline storage | a baseline store that lives outside your repository |

Skip this package if the renderer and the store already run in the same process
as the rest of the pipeline: the HTTP hop only pays for itself once rendering or
storage happens somewhere else.

## Requirements

Node 22 or newer, and ESM — every `@variance-authority/*` package is
`"type": "module"` and has no CommonJS build. The CLI, when you use it, requires
Node 22.15.

Both servers listen on `127.0.0.1`. To reach either one from another machine,
put a reverse proxy on the same host and point the client at the proxy. That
proxy is also where TLS goes: the servers speak plain HTTP, and the renderer
server has no authentication of its own (see
[Authentication](#authentication)).

## Put the renderer on another machine

**1. Install, on both machines.** The client needs this package; the render host
needs this package and a renderer to serve. Playwright's browser binaries do not
arrive with an `npm install`:

```bash
# on every machine that runs the pipeline
npm install --save-dev @variance-authority/remote

# on the render host, additionally
npm install --save-dev @variance-authority/playwright
npx playwright install chromium
```

**2. Serve the renderer on the render host.** Save this as `render-server.mjs`
and run it with `node render-server.mjs`:

```js
import { serveRenderer } from '@variance-authority/remote/renderer';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';

const server = await serveRenderer(await createPlaywrightRenderer(), 7777);
console.log(`rendering at ${server.url}`);

// The process stays alive while the port is bound. Give it a way out.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void server.close().then(() => process.exit(0)));
}
```

Top-level `await` needs the `.mjs` extension, or `"type": "module"` in the
`package.json` beside the file.

**3. Point the run at it.** In `variance.config.json`, on the machine that runs
the suite — replace the host with your proxy's:

```json
{
  "renderer": { "endpoint": "http://renderer.internal:7777" }
}
```

```bash
npx variance run
```

`renderer` is mutually exclusive with `browser`: a config naming both is
refused, rather than one of the two being quietly ignored.

### What you get

A liveness check, and the fingerprint the run will compare against — `identity`
is the machine-and-software description of whatever painted an image, and two
images stored under different identities are never diffed against each other:

```bash
curl http://renderer.internal:7777/identity
```

```json
{
  "renderer": "playwright-chromium",
  "engine": "chromium@131.0.0",
  "platform": "linux/x64",
  "deviceScaleFactor": 2,
  "fonts": ["Inter/400/normal/abc"]
}
```

The client fetches that once, at `connectRenderer`, rather than letting you
declare it. It then predicts the identity each document will be painted under
and checks the raster that comes back against the prediction. A far end that
painted under something else throws, naming both identities, instead of storing
an image under a key nothing will ever look up.

### Connecting by hand

If you compose the pipeline yourself instead of running the CLI, the client is
one call and the object it returns is an ordinary `Renderer`:

```js
import { connectRenderer } from '@variance-authority/remote/renderer';

const renderer = await connectRenderer({ endpoint: 'http://renderer.internal:7777' });
const raster = await renderer.render(document); // `document` from your collector
```

`renderer.close()` is a no-op: the browser's lifetime belongs to whoever runs
the server, so a client cannot end another run's server.

## Put the baseline store on another machine

A **baseline** is the approved image for one **subject** — one named UI state
you asked for and can ask for again. A remote store keeps those bytes behind an
endpoint you operate, instead of in your repository.

**1. Install, on both machines.**

```bash
npm install --save-dev @variance-authority/remote

# on the store host, additionally, for a filesystem-backed store
npm install --save-dev @variance-authority/store
```

**2. Serve the store.** Save as `store-server.mjs` and run it:

```js
import { serveRasterStore } from '@variance-authority/remote/store';
import { createDurableStore } from '@variance-authority/store/durable';

const server = await serveRasterStore(createDurableStore('/srv/variance/baselines'), {
  port: 7788,
  token: process.env.VARIANCE_BASELINES_TOKEN,
});
console.log(`baselines at ${server.url}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void server.close().then(() => process.exit(0)));
}
```

`port` defaults to `0`, which binds a free port and reports it on `server.url` —
useful in a test, wrong for a service you want a stable endpoint for. `token`
defaults to absent, which means the socket is the only gate.

**3. Point the run at it.** In `variance.config.json`:

```json
{
  "retention": "durable",
  "baselines": {
    "kind": "remote",
    "endpoint": "https://variance.internal",
    "token": { "env": "VARIANCE_BASELINES_TOKEN" }
  }
}
```

Approval writes through the same endpoint, so no baseline commit is involved:

```bash
npx variance accept Button/primary
```

### Connecting by hand

`createRemoteStore` constructs synchronously and returns an ordinary
`RasterStore`:

```js
import { createRemoteStore } from '@variance-authority/remote/store';

const store = createRemoteStore({
  endpoint: 'https://variance.internal',
  token: process.env.VARIANCE_BASELINES_TOKEN,
});

const found = await store.find({ subject: 'Button/primary' }, renderer.identity);
```

`find` answers `null` only when the server positively said there is no baseline
for that key. Every other outcome throws — see
[Failure behavior](#failure-behavior).

## The wire

Four things cross, and all four are plain JSON:

- a **render document** — the serializable description of what to paint
- a **raster** — the painted image, its pixels carried as base64
- a **baseline description** — a baseline's metadata (its document digest, the
  identity that wrote it, whether it is comparable, which declared fonts were
  missing) without its image bytes
- a **cache entry** — a previously rendered raster, kept so an unchanged
  document is not repainted

A document collected in a jsdom unit test can therefore be painted by a pinned
renderer elsewhere, without changing the interfaces above or below the hop.

### Routes

`serveRenderer`:

| route | body | answer |
| --- | --- | --- |
| `GET /identity` | — | the renderer's `RenderIdentity` |
| `POST /render` | a `RenderDocument` | a `Raster` |
| `POST /render/batch` | `{ documents }` | `{ results }`, one entry per document |

`serveRasterStore` — every route is `POST`; any other method answers 405, and
there is no separate health route:

| route | body | answer |
| --- | --- | --- |
| `POST /baseline/find` | `{ key, identity }` | `{ found }` or `{ found: null }` |
| `POST /baseline/describe` | `{ key, identity }` | `{ described }` or `{ described: null }` |
| `POST /baseline/working-set` | `{ keys, identity }` | `{ entries }` |
| `POST /baseline/put` | `{ key, raster }` | `{ ok: true }` |
| `POST /cache/find` | `{ digest, identity }` | `{ raster }` or `{ raster: null }` |
| `POST /cache/put` | `{ raster }` | `{ ok: true }` |

An unknown route on either server answers 404 with `{ "error": … }`. A handler
that throws answers 500 with the same shape, never an empty image and never an
empty answer.

### Authentication

`serveRasterStore` takes a `token` and requires `Authorization: Bearer <token>`
on every request; `createRemoteStore` takes the matching `token` and sends it.

`serveRenderer` has no token option, and the CLI's `renderer` config has no
token field for the same reason: a field that accepted a credential nothing
transmits would read as protection that is not there. Keep the render endpoint
inside a network you control, or put authentication in the proxy in front of it.

### Client and server versions

Both halves ship from this one package, and nothing on the wire carries a
version number. Install the same version of `@variance-authority/remote` on
every machine.

Two checks catch a disagreement that gets past that rather than letting it
become a wrong verdict. The renderer client refuses any raster whose identity is
not the one it predicted for that document. The store client rebuilds every
response field by field and throws on anything it cannot read — including a
`comparable` or a `missingFonts` that is absent, which it will not default,
because a default there is a claim about a machine it never heard from.

## Batching

`render(document)` is unchanged and takes one document. Underneath, calls that
overlap in time go out as one request to `/render/batch`.

A run paints many subjects at once, and one request per subject pays for a
connection, a round trip, and — on a farm that scales to zero — a chance of a
cold start, around a paint costing about 65 ms.

`connectRenderer` options:

| option | default | when to change it |
|---|---|---|
| `maxBatch` | `16` | A farm with a request-size limit, or one whose per-request timeout is tighter than a batch of paints |
| `batchWindowMs` | `0` | Raise it only against a farm billed **per invocation**. Zero sends what is already waiting on the next turn of the loop, so a serial caller pays nothing; a window taxes that caller on every item and cannot help them |
| `timeoutMs` | `30000` | A render that hangs must fail rather than stall the run. Applied per batch, scaled by its size, so a large batch is not failed for being large |
| `fetch` | `globalThis.fetch` | Substitute it to route through a proxy or add headers |

`createRemoteStore` takes `endpoint`, `token`, `timeoutMs` and `fetch`. Its
requests are not batched; its saving is the prefetch below.

Two properties batching does not soften. **The identity check stays per
document**, so a raster is never filed under "somewhere in these sixteen". And
**one document's failure is one document's**: the server answers per item, so a
malformed subject fails only itself, not the fifteen it travelled with. Only a
transport failure — nothing came back at all — fails the whole batch.

`batching(send, options)`, from the root entrypoint, is that batcher on its own.
It takes `maxBatch` and `windowMs`.

Nothing is retried. A request that fails, fails the call that made it.

## Prefetch baseline descriptions

Most subjects settle from the **sidecar** — the small JSON record stored beside
a baseline image, holding its document digest, its identity and its missing
fonts. Reading one is 32 hex characters and no image fetched. Over a socket that
saving is spent again as one request per subject.

`expect(keys)` is where a caller says which subjects this run is going to ask
about. The client then fetches all of their descriptions for one identity from
`/baseline/working-set` in a single request and answers `describe` out of it.

`npx variance run` calls it for you, after it has narrowed the run, so a run
scoped by `--since` does not fetch what it will not consult. Calling it by hand
looks like this:

```js
store.expect?.([{ subject: 'Button/primary' }, { subject: 'Button/disabled' }]);
```

`expect` is optional on `RasterStore` — a store on a disk does not implement it,
hence the `?.` — and it is a hint, never a question. A subject outside the
declared set is looked up exactly as it would have been. A subject with no
baseline comes back as an *answer* rather than a miss, so a first run costs one
request too.

## Failure behavior

Every failure mode **throws**; none is translated into a missing baseline:

| failure | what it must not be |
|---|---|
| unreachable endpoint | a missing baseline |
| refused token | a missing baseline |
| failing backing store (500) | a missing baseline |
| a lookup that hangs | a stalled run |
| a 200 whose body is not an answer | an answer |
| a bare `null` body | a miss |
| a baseline that does not say whether it is comparable | a comparable baseline |

They share one safety boundary. A subject with no baseline gets the verdict
`new`, and `new` records what is on screen as the baseline. So a network blip
read as a miss does not just skip a check — it **destroys the thing the check
was against, and reports success while doing it.**

The one exception is the render cache, which cannot reach a verdict: a cache
lookup that fails is a miss, and the run repaints. It is slower, not wrong.

### What you get

A store that answers 401 — the endpoint, the status, the server's own words, and
the consequence that was avoided:

```text
RasterStoreError: baseline store https://variance.internal/baseline/find returned 401:
{"error":"missing or wrong bearer token"}. This is an operator error, not a verdict:
reporting it as a missing baseline would record whatever is on screen and overwrite
the baseline this run was meant to compare against
```

A record that arrives over a socket passes the same checks a record read off a
disk passes, from `@variance-authority/raster`.

---

**[@variance-authority/remote](https://variance-authority.dev/reference/packages/remote)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
