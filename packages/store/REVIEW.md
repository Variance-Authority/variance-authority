# Reviewing `@variance-authority/store`

## Contracts

- **Missing is a pair; anything less throws.** Pinned by
  [durable.test.ts](src/durable.test.ts).
- **Another machine's baseline is found, never compared.** Written in
  [README](README.md#choose-a-backend).
- **Two subjects never share a path.** Pinned by
  [path-template.test.ts](src/path-template.test.ts).
- **A pointer is never an image.** Pinned by [lfs.test.ts](src/lfs.test.ts).
- **What git did not check is said.** Pinned by [lfs.test.ts](src/lfs.test.ts).
- **An empty changelog is an answer only when git read one.** Written in
  [README](README.md#read-why-a-baseline-changed).
- **Concurrent publishes keep both entries.** Pinned by
  [share-line.test.ts](src/share-line.test.ts).
- **The render cache never throws.** Written in
  [README](README.md#choose-a-backend).
