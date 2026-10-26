# Reviewing `@variance-authority/jsx-source`

Build instrumentation: a `jsxDEV` runtime that writes the location the JSX
transform computed onto props under a symbol, so a production React build can
name the line that wrote each element. A Vite plugin, a Jest resolver and
`under` swap it in for `react/jsx-dev-runtime`; `@variance-authority/react`
reads the symbol off the fiber.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/jsx-source/`.

## Contracts

- **The location reaches the node, and nothing compared moves.** Never in the
  document, the props digest or a snapshot hash. Written in [README › Package
  boundary](README.md#package-boundary); pinned by
  [src/located.test.ts](src/located.test.ts) › "puts nothing in the document"
  and "does not enter the props digest".
- **No location, no change.** No source, an empty file or no line hands React
  what it would have received. Pinned by
  [src/located.test.ts](src/located.test.ts) › "renders exactly as React would,
  and reports no source" and [src/record.test.ts](src/record.test.ts) › "hands
  back what React would have received".
- **A keyed element keeps its location**, and the config's key wins. Written in
  [README › Runtime cost](README.md#runtime-cost); pinned by
  [src/located.test.ts](src/located.test.ts) › "keeps the location on a keyed
  element" and [src/record.test.ts](src/record.test.ts) › "prefers the key in
  the config to the one the transform passed".
- **Only `react/jsx-dev-runtime` is answered, never for the runtime itself.**
  Written in [README › `jsxSource()`](README.md#jsxsource); pinned by
  [src/vite.test.ts](src/vite.test.ts) › "leaves the recording runtime importing
  React alone" and "runs ahead of the resolver that would answer for React
  first".
- **A layer above keeps working, and is still located**, one fiber up when it
  rebuilds props. Written in [README › When it does not
  work](README.md#when-it-does-not-work); pinned by
  [src/under.test.ts](src/under.test.ts) › "keeps the layer working" and
  "records an element the layer rebuilds, one fiber above it".
- **The production entry records nothing.** Written in [README ›
  Entrypoints](README.md#entrypoints); pinned by
  [src/entrypoints.test.ts](src/entrypoints.test.ts) › "re-exports React s
  runtime unchanged".

## Not this package's

- Reading the symbol and making a path relative: `@variance-authority/react` and
  the collector. Whether the transform emits `jsxDEV`: the build's config.
