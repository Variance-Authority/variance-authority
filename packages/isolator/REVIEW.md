# Reviewing `@variance-authority/isolator`

## Contracts

- **Only state a session can change moves.** Written in [README › What it
  rewrites](README.md#what-it-rewrites); pinned by
  [src/transform.test.ts](src/transform.test.ts).
- **What it cannot rewrite safely stays shared, and is named.** Written in
  [README › What it leaves](README.md#what-it-leaves-and-tells-you); pinned by
  [src/transform.test.ts](src/transform.test.ts).
- **A session starts from the module as it finished loading, copied as the
  module would see it.** Pinned by [src/runtime.test.ts](src/runtime.test.ts).
- **`sideEffects` is sense's reading, the one selection uses.** Written in
  [README › Keep a variable shared](README.md#keep-a-variable-shared); pinned by
  [src/skips.test.ts](src/skips.test.ts) and
  [src/jest.test.ts](src/jest.test.ts).
- **Every line keeps its number.** Pinned by
  [src/transform.test.ts](src/transform.test.ts).
- **The innermost session wins**, whichever copy of the Node entry started it.
  Written in [README › Where the session comes
  from](README.md#where-the-session-comes-from); pinned by
  [src/runtime.test.ts](src/runtime.test.ts).
