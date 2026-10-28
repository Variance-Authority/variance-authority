# Reviewing `@variance-authority/jsx-source`

## Contracts

- **The location reaches the node, and nothing compared moves.** Written in
  [README › Package boundary](README.md#package-boundary); pinned by
  [src/located.test.ts](src/located.test.ts).
- **No location, no change.** Pinned by
  [src/located.test.ts](src/located.test.ts) and
  [src/record.test.ts](src/record.test.ts).
- **A keyed element keeps its location**, and the config's key wins. Written in
  [README › Runtime cost](README.md#runtime-cost); pinned by
  [src/located.test.ts](src/located.test.ts) and
  [src/record.test.ts](src/record.test.ts).
- **Only `react/jsx-dev-runtime` is answered, never for the runtime itself.**
  Written in [README › `jsxSource()`](README.md#jsxsource); pinned by
  [src/vite.test.ts](src/vite.test.ts).
- **A layer above keeps working, and is still located**, one fiber up when it
  rebuilds props. Written in [README › When it does not
  work](README.md#when-it-does-not-work); pinned by
  [src/under.test.ts](src/under.test.ts).
- **The production entry records nothing.** Written in [README ›
  Entrypoints](README.md#entrypoints); pinned by
  [src/entrypoints.test.ts](src/entrypoints.test.ts).
