# Reviewing `@variance-authority/dom`

Reads a capture and a render document out of an element somebody else
mounted, under jsdom or a browser, keeping only the CSS that can apply to it.
`storybook-collector`, `route-collector`, `unit-test` and `playwright-test`
call it; `core` normalizes what it returns, `raster` paints the document.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under `packages/dom/`.

## Contracts

- **Pruning is applicability, nothing more.** A rule that matches nothing in
  the subject moves no hash; a rule that does apply always does. Written in
  the [README](README.md#what-applicability-pruning-removes) and pinned by
  [`src/collect.test.ts`](src/collect.test.ts) › "is unmoved by a page full of
  CSS that matches nothing in the subject" and "still reacts to a rule that
  does apply".
- **A rule is filed by its rightmost compound, read whole.** An escaped or
  hex-escaped class, an escaped `#` and an attribute value never file a rule
  under the wrong key. Pinned by [`src/css-key.test.ts`](src/css-key.test.ts)
  › "files a class holding an escaped # by the class, never as an id" and
  "reads no id or class out of an attribute value".
- **A reused index answers as a fresh one, or is refused.** Pinned by
  [`src/style-index.test.ts`](src/style-index.test.ts) › "produces the same
  snapshot from a reused index as from a fresh one" and "refuses an index
  built for a different viewport rather than answering for the wrong one".
- **What the host cannot observe is said, never passed.** jsdom geometry is
  unobserved, an uncomputable `content` is `unread`, a missing font hash or
  portal provider is a diagnostic. Written in the
  [README](README.md#requirements) and pinned by
  [`src/collect.test.ts`](src/collect.test.ts) › "reports geometry as
  unobserved rather than passing it" and "never lets a caller claim a rung
  the host cannot observe".
- **An excluded node is marked, never deleted.** Pinned by
  [`src/ignore.test.ts`](src/ignore.test.ts) › "keeps the excluded element in
  the capture rather than deleting it" and "survives wrapper collapse, so the
  exclusion does not evaporate".
- **A document is addressed by what it paints.** The same page read twice,
  its frame's classes in any order, a stamp landing later, or a served port
  give one digest. Pinned by [`src/document.test.ts`](src/document.test.ts) ›
  "addresses the same frame whichever order its classes were added in" and
  "produces one digest for two readings that differ only in when a stamp
  landed", and [`src/assets.test.ts`](src/assets.test.ts) › "keys an asset
  from the page origin by its path, so the served port is no part of it".
- **A `blob:` URL leaves as its bytes, or as an error.** Written in the
  [README](README.md#images-a-page-made-itself).
- **No framework code.** Names and portals come only from the providers a
  caller passes. Written in
  [spec 0019](../../docs/specs/0019-provenance-without-react.md).
