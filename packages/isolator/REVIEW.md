# Reviewing `@variance-authority/isolator`

A build transform that moves a module's mutable top-level state into a frame
with one set of values per session. Jest, Rspack and webpack call it; ioc's
reset driver, `isolated(fn)`, React's `cache` and `nextSession()` say what the
session is.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/isolator/`.

## Contracts

- **Only state a session can change moves.** A `let` nobody writes, a function,
  a class, a call's result and every export keep their binding. Written in
  [README › What it rewrites](README.md#what-it-rewrites); pinned by
  [src/transform.test.ts](src/transform.test.ts) › "never wraps a function or a
  class, whatever declares it".
- **What it cannot rewrite safely stays shared, and is named.** An exported
  `let`, an object that leaves the module or holds one that does or an import, a
  class instance, a top-level `await` or `eval` is left with a reason. Written
  in [README › What it leaves](README.md#what-it-leaves-and-tells-you); pinned
  by [src/transform.test.ts](src/transform.test.ts) › "an object that holds an
  import" and "leaves a module that calls eval whole".
- **A session starts from the module as it finished loading, copied as the
  module would see it.** Never from what the loading session wrote since;
  arrays, plain objects and `Map` values are copied once each, aliases stay
  aliases, `Set` members, frozen objects and instances are shared, and dead
  zones and `const` still throw. Pinned by
  [src/runtime.test.ts](src/runtime.test.ts) › "starts every other session from
  what the module held when it loaded, not what the session it loaded in wrote
  since", "keeps an alias an alias of the object its session holds" and "refuses
  a write to a let inside its own initializer, as the module would".
- **`sideEffects` is sense's reading, the one selection uses.** A single pattern
  is a list of one, built output leaves its source, absent or `false` is
  rewritten, and Jest's cache key carries the verdict. Written in [README › Keep
  a variable shared](README.md#keep-a-variable-shared); pinned by
  [src/skips.test.ts](src/skips.test.ts) › "reads a single pattern as a list of
  one" and [src/jest.test.ts](src/jest.test.ts) › "keys a module by whether its
  package declares side effects, so declaring them reaches a cached module".
- **Every line keeps its number.** Pinned by
  [src/transform.test.ts](src/transform.test.ts) › "maps every rewritten line to
  the line it came from".
- **The innermost session wins**, whichever copy of the Node entry started it.
  Written in [README › Where the session comes
  from](README.md#where-the-session-comes-from); pinned by
  [src/runtime.test.ts](src/runtime.test.ts) › "reads the innermost isolated
  session, whichever copy of the Node entry started it".

## Not this package's

- Matching `sideEffects`: `@variance-authority/sense/side-effects`. When a reset
  runs: `@variance-authority/ioc`.
