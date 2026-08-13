# 0023 — The version that never lost it

**Date:** 2026-08-13
**Question:** [0022](0022-the-error-react-already-threw.md) shipped a zero-config
call site by reading the `Error` React 19 captures and resolving its frame
through the dev server's source map. It was proved against React 19 and nothing
else. Most installed React is not 19. Does the same claim survive the version an
adopter is actually on, and if it does, is it the same mechanism?

## It survives, and it is not the same mechanism

React 18 never lost the location. Its `jsxDEV` takes the transform's fifth
argument, keeps it on the element as `_source`, and the reconciler copies it onto
the fiber as `_debugSource` — `{fileName, lineNumber, columnNumber}`, exact,
computed by the compiler. React 19 is the version that stopped: `jsxDEV` there
takes four parameters and synthesizes its own error for the fifth.

So the two majors are opposite shapes of the same answer.

| | What the fiber carries | What it costs to read |
| --- | --- | --- |
| React 18 | `_debugSource`, the compiler's own location | nothing |
| React 19 | `_debugStack`, an `Error` | a module fetch and a source-map decode |

The reading order was already right and needed no version test: `resolveProvenance`
looks for a recorded location first and only falls back to frames when there is
none. A location the compiler computed beats one that has to be resolved, on
every axis — no fetch, no map, no frame-selection policy, and no dependence on
the dev server emitting maps at all. React 19 is the expensive path, and it is
expensive because React 19 threw the cheap one away.

## What this cost to support

Nothing in `packages/react`. The field was already read, in the branch written
for React ≤18 when `jsx-source` was the only route. What was missing was the
proof, and the proof is what found the corner.

`packages/route-collector/src/zero-config.chromium.test.ts` now builds four
fixtures rather than two — the empty config and the `jsx: 'automatic'` config,
each against React 19 and React 18 — and three of them report every element's
own line and column byte-exact.

## The corner with nothing in it

**React 18 with the classic transform records no location at all.** esbuild emits
`__source` for the automatic runtime and not for `createElement`, and React 18
captures no error of its own to make up the difference. Both fields are absent
and there is nothing to fall back to but the component name.

It is narrow — reaching it means being on React 18 *and* declining the transform
React has defaulted to since 2020 — and it is exactly what
[`@variance-authority/jsx-source`](../../../packages/jsx-source) was written for.
It is asserted as a test rather than described as a caveat, because a claim about
what does not work rots the moment it stops being true.

Its React 19 counterpart is not a corner at all: React captures the same error
inside `createElement`, so the classic transform there is fully served.

## Two shapes of one path, and why the file differs

React 19's file comes out of a source map, whose `sources` resolve against the
URL the browser was served, so it arrives relative to the served root. React 18's
is the compiler's `fileName`, which every bundler writes absolute and which
normalization makes repository-relative against the run's root.

For a real project those are the same directory — the dev server and the run
both start at the project root — and both land on `src/App.jsx`. For a fixture in
`os.tmpdir()` they are not, which is why the test states the expected path per
fixture rather than pretending one shape.

## What this does not serve

The boundary from 0022 is unchanged and the version work does not move it. A
minified production build carries neither field, on either major. That is the
plugin's case, and now the only other one is the classic corner above.
