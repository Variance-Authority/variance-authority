# 0021 — Underneath, rather than in front

**Date:** 2026-08-13
**Question:** [0020](0020-the-line-that-wrote-it.md) bought the last hop with
`jsxImportSource`. There is exactly one of that setting per build, and a large
share of React projects have already spent it — Emotion, theme-ui, anything with
a `css` prop. For those projects the answer shipped one day earlier is not a
setting to add, it is a runtime to give up.

The objection came with its own evidence: [React #31981](https://github.com/react/react/issues/31981)
asks for the location back, and the [comment thread on #28265](https://github.com/react/react/pull/28265#issuecomment-2715498235)
is what happens when a tool takes that setting from a project that was using it.

## Two candidate mechanisms, and why the second one is not the second one

The obvious framing is *another transformer, on top of whatever the project
already runs*. Chaining above the custom runtime, so both get their turn.

That is the wrong direction, and it fails for a reason that is worth writing
down: a chain above Emotion still has to hand Emotion something, and Emotion's
job is to rebuild the props. Whatever the outer runtime writes, the inner one
decides whether it survives.

The other framing — patch `jsx`/`createElement` at runtime — fails on
immutability. An ESM namespace object is sealed with read-only bindings, so
`R.jsxDEV = f` throws, and bundlers snapshot CJS named exports at instantiation,
so a mutation lands after everyone has already bound. Monkey-patching is not
unreliable here in the "works most of the time" sense; it is unreliable in the
"depends on which of four module formats the consumer's bundler picked" sense.

What both framings share is the assumption that we have to be *somewhere in the
chain*. We do not. Every custom JSX runtime in ordinary use is a wrapper, and
every wrapper bottoms out in the same specifier:

```
your component  →  @emotion/react/jsx-dev-runtime  →  react/jsx-dev-runtime
```

So the place to stand is the bottom. Replace the module `react/jsx-dev-runtime`
resolves to, and one runtime serves every custom runtime layered above it at
once — including ones written after this — because each of them forwards the
transform's source argument on the way down. `jsxImportSource` is never
mentioned and never taken.

## What was built

`under(development, production)` — the wrapper both install routes are made
from. It takes React's runtimes as **arguments** rather than importing them,
because a module resolved *as* `react/jsx-dev-runtime` cannot itself import that
specifier. The production runtime is a parameter because React's production
build exports `jsxDEV = undefined`, so a build that turned `jsxDev` on for one
half of its graph and not the other still renders.

Two installers, because two ecosystems answer module requests differently:

- **`/vite`** — a `resolveId` hook at `enforce: 'pre'`. One plugin covers three
  build tools: a Vite application, Storybook's React builder, and Vitest.
- **`/jest-resolver`** — the same swap, written in CommonJS because Jest loads a
  resolver synchronously.

Both need the same guard, and it is the crux of the design: **the recording
runtime's own request for `react/jsx-dev-runtime` must not be intercepted**, or
it resolves to itself. Vite guards on `importer`, Jest on `options.basedir`.
This is also why `moduleNameMapper` cannot do the job — it rewrites requests
without seeing who asked.

## What Emotion does to it, measured

Verified against Emotion 11.14 with `jsxImportSource: '@emotion/react'` left
exactly where it was:

Four elements in one throwaway probe component, each written on a line the probe
knows and the runtime has to rediscover:

| element | written at | recorded at | hops |
|---|---|---|---|
| `<span className="styled">` | line 8, column 10 | line 8, column 10 | 0 |
| `<b css={{...}}>` | line 12, column 10 | line 12, column 10 | **1** |
| `<li key={...}>` | line 18, column 31 | line 18, column 31 | 0 |
| `<ul>` | line 17, column 5 | line 17, column 5 | 0 |

`class="styled css-ewfpmk"` in the same output, which is the control: Emotion is
still doing its work.

The one-hop row is `createEmotionProps`, which copies with `for…in` and
therefore drops symbols — the same mechanism that makes the symbol free
everywhere else costs us here. What is *not* lost is the location itself:
Emotion forwards the source argument untouched, so the runtime underneath still
records the `<b>`'s own line — onto the wrapper's props rather than the host's.
`resolveProvenance` now climbs composite ancestors until it reaches a host
element, which recovers it. The climb never fires for a node whose own location
was recorded, so it costs nothing on the common path.

## Three runners, end to end

Not three configurations of one probe — three real test runners, each beside
real Emotion:

- **Storybook** — `storybook build`, production and minified, plugin installed
  and `jsxImportSource` gone from `.storybook/main.js`. 36 recorded locations in
  the bundle, and the case suite's 18 tests pass, including the one that asserts
  the report names `src/ds.jsx:53` (where `<button>` is written) and not `:51`
  (where `Button` is declared).
- **Vitest** — the same `jsxSource()` plugin, with `server.deps.inline` for
  Emotion. All four elements correct.
- **Jest** — `@babel/preset-react` at `{runtime: 'automatic', development: true,
  importSource: '@emotion/react'}` plus `resolver:
  '@variance-authority/jsx-source/jest-resolver'`. All four elements correct.

## The thing that was measured and not shipped

React 19 replaced `_debugSource` with `_debugStack`, an `Error` constructed
inside its own `jsxDEV`. It is present on every fiber, host and composite. With
Emotion in the chain, frame[0] is React, frame[1] is Emotion and frame[2] is the
call site; resolving that frame's bundle position through the source map yields
line 5, column 9 of the probe — byte-identical to the transform's own
`lineNumber: 5, columnNumber: 10`, once the frame's 0-based column is read as
0-based.

Zero build configuration, composes with everything, and **React development
builds only**. The Storybook this repository tests against is a minified
production build, which is exactly the case it cannot serve. Recorded here as a
complement worth building later, not as a replacement.

## What is still open

- **The swap reaches code the bundler processes and no other.** A dependency
  marked external resolves its import of React at runtime, past any resolver.
  This was found the hard way — a probe where the alias silently did not fire —
  and it is a real constraint rather than a probe artifact.
- **The `css`-prop row costs a fiber.** It is recovered by a climb, and the
  climb assumes the wrapper is composite and the recorder is an ancestor. A
  custom runtime that rebuilt props *and* forwarded to a host element directly
  would lose it. None of the ones measured do.
- **A `.ts` Vite config in a package that is not `"type": "module"`** loads as
  CommonJS and cannot require this package. Renaming to `.mts` is the fix, and it
  is the first thing a consumer will hit.
