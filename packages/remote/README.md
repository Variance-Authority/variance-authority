<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/remote

> Run a Variance Authority renderer or baseline store on the other side of an HTTP hop.

Use this package when rendering or baseline storage must happen in another
process or on another machine — for example, painting screenshots on a box with
a pinned browser while the rest of the pipeline runs elsewhere. The server
wraps a **renderer** (the pluggable component that paints a document into an
image) or a **store** (the pluggable component that holds baselines and a
render cache) that you supply, and exposes it over one HTTP protocol shared by
the client and the server.

Skip this package if the renderer and the store already run in the same
process as the rest of the pipeline: the HTTP hop only pays for itself once
rendering or storage happens somewhere else.

**Requires:** a port to bind for a server, or an endpoint to reach for a client.
The package does not provide a renderer, a database, or a baseline policy.

```bash
npm install --save-dev @variance-authority/remote
```
## What crosses the wire

A **render document** (the serializable description of what to paint), a
**raster** (the painted image, its pixels carried as base64), a **baseline
description** (a baseline's metadata — digest, comparability, missing fonts —
without its image bytes), and a **cache entry** (a previously rendered raster,
kept so an unchanged document is not repainted) are all plain JSON. A document
acquired in a jsdom unit test can therefore be painted by a pinned renderer
elsewhere without changing the interfaces above or below the hop.

## Client and server entrypoints

The client and server ship from one package. A client and server that disagree
about the wire format fail silently, as a wrong verdict rather than an error.

| entrypoint | holds |
|---|---|
| `.` | both tools, both halves |
| `./renderer` | `connectRenderer`, `serveRenderer` |
| `./store` | `createRemoteStore`, `serveRasterStore` |

## Usage

A server pins one renderer; a client anywhere else connects to it as if it were
local:

```ts
import { serveRenderer, connectRenderer } from '@variance-authority/remote/renderer';
import { createPlaywrightRenderer } from '@variance-authority/playwright';

// On the machine that pins its pixels:
const server = await serveRenderer(await createPlaywrightRenderer(), 7777);

// Anywhere else — the pipeline cannot tell the difference:
const renderer = await connectRenderer({ endpoint: 'http://pinned-runner:7777' });
```

`serveRenderer` and `serveRasterStore` wrap whatever you hand them. Neither knows
what is behind it, which is why the local and remote sides cannot answer
`identityFor` differently — they share the derivation rather than each having
one.

## Batch overlapping renders

`render(document)` is unchanged and takes one document. Underneath, calls that
overlap in time leave as **one request** to `/render/batch`, because a run's
raster tier goes as wide as the operator allowed, and one request per
**subject** (the component or page a baseline represents) pays a connection, a
round trip and — on a farm that scales to zero — a chance of a cold start, per
subject, around a paint that costs ~65 ms.

The batching is under the interface rather than in it: nothing upstream learns a
new shape, no caller picks a size, and the local and remote renderers stay
interchangeable.

| option | default | when to change it |
|---|---|---|
| `maxBatch` | 16 | A farm with a request-size limit, or one whose per-request timeout is tighter than a batch of paints |
| `batchWindowMs` | `0` | Raise it only against a farm billed **per invocation**. Zero sends what is already waiting on the next turn of the loop, so a serial caller pays nothing; a window taxes that caller on every item and cannot help them |
| `timeoutMs` | `30000` | A render that hangs must fail rather than stall the run |
| `fetch` | `globalThis.fetch` | Substitute it to route through a proxy or add headers |

`createRemoteStore` takes the same `endpoint`, `timeoutMs` and `fetch`, plus
`token` — the bearer the operator set on the service. Unlike `connectRenderer`,
it constructs synchronously: a store has no identity of its own to learn up
front, only the renderer's identity, which travels on every call instead.

Two properties the batch does not get to soften. **The identity check stays per
document**, so a raster is never filed under "somewhere in these sixteen". And
**one document's failure is one document's**: the server answers per item, so a
malformed subject fails only itself, not the batch it travelled with. Only a
transport failure — nothing came back at all — fails the whole batch.

## Serving the other half

`serveRenderer(renderer, port)` takes its port positionally, because a renderer
server has nothing else to decide. `serveRasterStore(store, options)` takes
`ServeStoreOptions`:

| option | default | what it decides |
|---|---|---|
| `port` | `0` | `0` binds a free port and reports it on `StoreServer.url`; choose a fixed port for a stable service endpoint |
| `token` | none | the bearer required on every request. Absent means the socket is the only gate — a decision for the operator's network, not a default this package can make for them |

`batching(send, options)` is the batcher itself, exported because the renderer
client is not the only thing that could want it. It takes `maxBatch` and
`windowMs` — the same two knobs `connectRenderer` surfaces as `maxBatch` and
`batchWindowMs`, renamed there because at that level "batch" is already implied
and `windowMs` alone would read as a timeout.

## Prefetch store metadata

Most subjects settle from the sidecar — 32 hex characters, no image moved — and
over a socket that saving is spent again as one request per subject. `expect(keys)`
on the store is where a caller says which subjects this run is going to ask about;
the client then fetches all of their sidecars for one identity from
`/baseline/working-set` in a single request, and answers `describe` out of it.
`variance run` declares the set after selection, so a narrowed run does not fetch
what it will not consult.

It is a hint and never a question. It is optional on `RasterStore`, so a store on
a disk simply does not have it; a server from before the path existed answers 404
and the client falls back to one request per key; a subject with no baseline comes
back as an *answer* rather than as a miss, so a first run costs one request too.
Nothing about it can move a verdict, which is the property that lets it be added
to a deployed protocol at all.

## Validate remote records

A record off a socket passes the same checks a record off a disk passes, from
`@variance-authority/raster`. Two copies of those checks would be two
ideas of what a baseline is, and the one that drifts is the one that accepts a
record the other refuses.

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
| a baseline with no stated comparability | a comparable baseline |

They share one safety boundary. `new` re-records what is on screen, so a network blip
read as a miss does not skip a check — it **destroys the thing the check was
against, and reports success while doing it.**
