# Reviewing `@variance-authority/remote`

## Contracts

- **No store failure is a missing baseline.** Written in
  [README](README.md#failure-behavior); pinned by
  [`src/store.test.ts`](src/store.test.ts).
- **A field the far end did not send is never defaulted.** Written in
  [README](README.md#client-and-server-versions); pinned by
  [`src/store-described.test.ts`](src/store-described.test.ts).
- **The render cache alone fails to a miss.** Pinned by
  [`src/store.test.ts`](src/store.test.ts).
- **The renderer's identity is learned and checked per document.** Written in
  [README](README.md#what-you-get) and [batching](README.md#batching); pinned by
  [`src/renderer.test.ts`](src/renderer.test.ts).
- **One item's failure is one item's; a reply is paired by position or
  refused.** Pinned by [`src/batch.test.ts`](src/batch.test.ts).
- **`expect` is a hint, never a question.** Written in
  [README](README.md#prefetch-baseline-descriptions); pinned by
  [`src/store.test.ts`](src/store.test.ts).
- **Nothing is retried, and every request has a deadline.** Written in
  [README](README.md#batching); pinned by
  [`src/transport.test.ts`](src/transport.test.ts).
- **The renderer takes no credential.** Written in
  [README](README.md#authentication).
