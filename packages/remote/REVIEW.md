# Reviewing `@variance-authority/remote`

Puts a `Renderer` or a `RasterStore` on the other side of an HTTP hop:
`serveRenderer` and `serveRasterStore` on the machine that owns the pixels or
the baselines, `connectRenderer` and `createRemoteStore` wherever the run is,
built by the CLI from `renderer.endpoint` and `baselines.kind: "remote"`.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/remote/`.

## Contracts

- **No store failure is a missing baseline.** An unreachable endpoint, a refused
  token, a `500`, a hang, a `200` that is not an answer and a bare `null` all
  throw; `find` answers `null` only when the server said so. A miss makes the
  verdict `new`, which overwrites the baseline. Written in the
  [README](README.md#failure-behavior) and pinned by
  [`src/store.test.ts`](src/store.test.ts) › "a store that cannot answer".
- **A field the far end did not send is never defaulted.** A description or
  baseline with no `comparable`, no `missingFonts`, no document digest, or no
  word on whether it kept its snapshot is refused. Written in the
  [README](README.md#client-and-server-versions) and pinned by
  [`src/store-described.test.ts`](src/store-described.test.ts) › "a description
  that cannot be trusted".
- **The render cache alone fails to a miss.** It decides nothing, so an
  unreadable cache body is a repaint, where a baseline body refuses. Pinned by
  [`src/store.test.ts`](src/store.test.ts) › "answers a cache body it cannot
  read as a miss, where a baseline body refuses".
- **The renderer's identity is learned and checked per document.** The client
  fetches it at connect, predicts it per document at the document's scale, and
  refuses a raster painted under another, inside a batch too; a render failure
  is never a blank image. Written in the
  [README](README.md#what-you-get) and [batching](README.md#batching); pinned by
  [`src/renderer.test.ts`](src/renderer.test.ts) › "refuses a raster the far end
  rendered under a different identity".
- **One item's failure is one item's; a reply is paired by position or
  refused.** Only a transport failure fails a whole batch. Pinned by
  [`src/batch.test.ts`](src/batch.test.ts) › "rejects only the caller whose item
  failed" and "refuses a reply of the wrong length rather than pairing by
  guess".
- **`expect` is a hint, never a question.** An undeclared subject is looked up
  as before; an unreachable working set throws rather than reading as empty;
  another machine's baseline stays `comparable: false`. Written in the
  [README](README.md#prefetch-baseline-descriptions) and pinned by
  [`src/store.test.ts`](src/store.test.ts) › "a declared working set".
- **Nothing is retried, and every request has a deadline.** Written in the
  [README](README.md#batching) and pinned by
  [`src/transport.test.ts`](src/transport.test.ts) › "still rejects by the
  deadline when the runtime refuses the signal".
- **The renderer takes no credential.** A token field nothing transmits would
  read as protection. Written in the [README](README.md#authentication).

## Where to look for a counterexample

- `src/store.ts`: every `catch` and every `?? default` on a decoded field. Try a
  `404` on `/baseline/working-set` (the per-key fallback) against a `404` on
  `/baseline/find`, and a body with `comparable` missing.
- `src/batch.ts`: a batch flushed at `maxBatch` while another call joins, and a
  reply shorter than the batch.
