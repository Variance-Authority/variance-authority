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
const server = await serveRenderer(await createPlaywrightRenderer({ viewport }), 7777);

// Anywhere else — the pipeline cannot tell the difference:
const renderer = connectRenderer({ endpoint: 'http://pinned-runner:7777' });
```

`serveRenderer` and `serveRasterStore` wrap whatever you hand them. Neither knows
what is behind it, which is why the local and remote sides cannot answer
`identityFor` differently — they share the derivation rather than each having
one.

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
