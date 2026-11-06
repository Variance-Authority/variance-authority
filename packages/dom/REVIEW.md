# Reviewing `@variance-authority/dom`

## Contracts

- **Pruning is applicability, nothing more.** Written in
  [README](README.md#what-applicability-pruning-removes); pinned by
  [`src/collect.test.ts`](src/collect.test.ts).
- **A rule is filed by its rightmost compound, read whole.** Pinned by
  [`src/css-key.test.ts`](src/css-key.test.ts).
- **A reused index answers as a fresh one, or is refused.** Pinned by
  [`src/style-index.test.ts`](src/style-index.test.ts).
- **What the host cannot observe is said, never passed.** jsdom geometry is
  unobserved, an uncomputable `content` is `unread`, a missing font hash or
  portal provider is a diagnostic. Written in [README](README.md#requirements);
  pinned by [`src/collect.test.ts`](src/collect.test.ts).
- **An excluded node is marked, never deleted.** Pinned by
  [`src/ignore.test.ts`](src/ignore.test.ts).
- **A document is addressed by what it paints.** Pinned by
  [`src/document.test.ts`](src/document.test.ts) and
  [`src/assets.test.ts`](src/assets.test.ts).
- **A `blob:` URL leaves as its bytes, or as an error.** Written in
  [README](README.md#images-a-page-made-itself).
- **No framework code.** Written in [spec
  0019](../../docs/specs/0019-provenance-without-react.md).
