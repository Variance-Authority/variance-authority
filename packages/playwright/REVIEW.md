# Reviewing `@variance-authority/playwright`

## Contracts

- **An unanswered asset refuses the read, for its own subject only.** Pinned by
  [src/network.chromium.test.ts](src/network.chromium.test.ts) and
  [src/acquire.test.ts](src/acquire.test.ts).
- **No silent hole in the environment key.** Written in [README › What the page
  was actually served](README.md#what-the-page-was-actually-served); pinned by
  [src/acquire.test.ts](src/acquire.test.ts).
- **What paints is in the identity, its spelling is not.** Pinned by
  [src/renderer.chromium.test.ts](src/renderer.chromium.test.ts).
- **A resource-closed document never reaches the network.** Pinned by
  [src/renderer.chromium.test.ts](src/renderer.chromium.test.ts).
- **Same content, same bytes.** Pinned by
  [src/harness.chromium.test.ts](src/harness.chromium.test.ts).
- **A declared engine that is missing throws**, naming it. Written in [README ›
  A run measures what it declares](README.md#a-run-measures-what-it-declares);
  pinned by [src/engines.test.ts](src/engines.test.ts).
- **Each width is its own subject id.** Pinned by
  [src/viewport.test.ts](src/viewport.test.ts).
