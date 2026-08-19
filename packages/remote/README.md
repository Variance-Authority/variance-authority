<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/remote

**Requires:** a port to bind, or a peer to reach. Nothing else: what is served is
whatever you hand the serving half.

The same tools, on the other side of a wire: a renderer reached over HTTP, and a
baseline store reached over HTTP.

## Why this package can exist at all

Every tool in this project takes and returns something **serializable**, and this
package is what that property is for. A document acquired in a jsdom unit test on
one machine can be painted by a pinned machine two networks away, and nothing
above or below the hop is written differently.

Proven byte-identically, in-process and over an HTTP hop, in
[`examples/todomvc/src/offload.chromium.test.tsx`](../../examples/todomvc).

## Both halves live together

The client and the server are **one protocol**. Split across two packages they
drift, and a client and a server disagreeing about a wire format is the class of
failure that presents as a verdict.

| entrypoint | holds |
|---|---|
| `.` | both tools, both halves |
| `./renderer` | `connectRenderer`, `serveRenderer` |
| `./store` | `createRemoteStore`, `serveRasterStore` |

## Usage

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

## Renders that overlap travel together

`render(document)` is unchanged and takes one document. Underneath, calls that
overlap in time leave as **one request** to `/render/batch`, because a run's
raster tier goes as wide as the operator allowed and one request per subject pays
a connection, a round trip and — on a farm that scales to zero — a chance of a
cold start, per subject, around a paint that costs ~65 ms.

The batching is under the interface rather than in it: nothing upstream learns a
new shape, no caller picks a size, and the local and remote renderers stay
interchangeable.

| option | default | when to change it |
|---|---|---|
| `maxBatch` | 16 | A farm with a request-size limit, or one whose per-request timeout is tighter than a batch of paints |
| `batchWindowMs` | `0` | Raise it only against a farm billed **per invocation**. Zero sends what is already waiting on the next turn of the loop, so a serial caller pays nothing; a window taxes that caller on every item and cannot help them |

Two properties the batch does not get to soften. **The identity check stays per
document** — it is the thing that stops a raster being filed under a key nobody
looks up, and a saving that widened it to "somewhere in these sixteen" would be
the worst possible trade. And **one document's failure is one document's**: the
server answers per item, so a malformed subject cannot turn the fifteen it
travelled with into failures somebody has to re-run to find innocent. A transport
failure is the one thing that belongs to the whole batch, because nothing came
back to attribute.

## Nothing that arrives is believed on different terms

A record off a socket passes the same checks a record off a disk passes, from
[`@variance-authority/raster`](../raster). Two copies of those checks would be two
ideas of what a baseline is, and the one that drifts is the one that accepts a
record the other refuses.

## A store that cannot answer is never heard as answering

Every failure mode is tested and every one of them **throws**:

| failure | what it must not be |
|---|---|
| unreachable endpoint | a missing baseline |
| refused token | a missing baseline |
| failing backing store (500) | a missing baseline |
| a lookup that hangs | a stalled run |
| a 200 whose body is not an answer | an answer |
| a bare `null` body | a miss |
| a baseline with no stated comparability | a comparable baseline |

They are all the same test. `new` re-records what is on screen, so a network blip
read as a miss does not skip a check — it **destroys the thing the check was
against, and reports success while doing it.**
