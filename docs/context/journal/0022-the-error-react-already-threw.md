# 0022 — The error React already threw

**Date:** 2026-08-13
**Question:** [0021](0021-underneath-rather-than-in-front.md) got out from under
`jsxImportSource` and left the smaller ask standing: a plugin in
`vite.config.js`, a resolver in `jest.config.js`, an entry in
`.storybook/main.js`, and `jsxDev: true` alongside. That is an edit to the build
that ships production code, made so that a test can see more. Stated as a goal:
*find a way where the end user can activate source only for Variance, without
altering production code in any way. We live in tests; we cannot demand more real
state than we should.*

0021 already recorded the mechanism that answers it, in the section titled
*The thing that was measured and not shipped*. This entry is what happened when
it was built.

## What React hands over for free

React's development build constructs `Error('react-stack-top-frame')` inside its
own element factory and keeps it on the fiber as `_debugStack`. Frame 0 is
React's runtime. Frame 1 is whoever wrote the element.

Three things about it matter more than the mechanism:

- **It is not the automatic transform.** React 19 captures the same error inside
  `createElement`, so this reaches hand-written elements, a class component's
  `render` body, and any project still on the classic transform — code a JSX
  transform never touches.
- **It needs nothing from the build.** No plugin, no `jsxImportSource`, no
  `jsxDev`. The requirement is that React is the development build, which every
  dev server, Vitest and Jest already give you, and that source maps exist,
  which they do.
- **The map hop is a browser problem only.** Node applies source maps to
  `Error.stack` itself, so a frame read under Vitest arrives already original.
  Chrome does not, so the collector has to do that hop.

## Where the work goes, and why the cost is bounded

The measurement that decided the shape, on a 4211-node document: every fiber
carried a stack, and between them they held **14 distinct call sites**. A
hundred-row table writes two thousand cells from one line of JSX. Reading every
stack cold costs 17.6 ms; resolution dedupes about 300:1.

So the resolver caches per call site and per module, and that cache is not an
optimization — it is what makes a page cost a handful of fetches instead of
thousands. One resolver per run, not per subject: every story in a Storybook is
written in the same handful of modules, so the second story onward resolves
without a single fetch.

## Three sides of a boundary

- **Page** (`packages/react`) — read `_debugStack`, drop frames whose URL is
  vendor, carry at most four candidates on `Provenance.stack`. No fetching: the
  agent runs inside somebody else's application, on a budget measured against
  their render loop.
- **Pure** (`packages/core/attribute`) — parse stacks, decode source maps, choose
  the author's frame. `core` has no third-party dependencies (ADR-0013), so the
  base64 VLQ decoder is written out; it is 200 lines and it is testable, which
  the dependency would also have been.
- **Node** (`packages/playwright`, both collectors) — fetch each module *through
  the page*, because the page already holds the origin, the cookies, the dev
  server's session and any certificate the browser was told to trust.

`Provenance.stack` is transient by construction and `normalize` drops it
unconditionally. A frame holds an absolute URL with a build hash in it; hashing
one would make every baseline disagree with the next dev-server restart.

**The author is the first frame that resolves to a file the project wrote.** A
custom JSX runtime is skipped because it resolves into `node_modules` — not
because it is on a list, which is why this composes with runtimes written after
it.

## The proof, and what its fixture says

`packages/route-collector/src/zero-config.chromium.test.ts` writes a React
application into a temporary directory, serves it with a real Vite dev server,
and collects it. Two fixtures, and their config files are the assertion:

| fixture | `vite.config.mjs` | transform | element factory |
|---|---|---|---|
| classic | `export default {}` | classic | `createElement` |
| automatic | `export default { esbuild: { jsx: 'automatic' } }` | automatic | `jsxDEV` |

Between them, one setting — `jsx: 'automatic'`, which is how a React project
says it is a React project — and one file with nothing in it at all. Neither
names a plugin, a `jsxDev`, a `jsxImportSource` or anything belonging to this
project.

Both report every element's line and column exactly: the `<span>` inside `Badge`
at its own line rather than at `Badge`'s declaration, and `<main>` and
`<section>` from one render of one component separated by the one line between
them.

## What this does not serve

**React development builds only.** The Storybook this repository tests against
is a minified production build, and there is no captured error in one. The two
install routes from 0020 and 0021 remain for that case, and they are now the
opt-in rather than the price of entry.

Two smaller things found while building it, both real and neither about React:

- **`os.tmpdir()` is a symlink on macOS**, and Vite resolves its own root. Leave
  the unresolved path in place and every module the fixture serves is judged to
  be outside the project it belongs to.
- **A cold dev server navigates twice.** Vite discovers an application's
  dependencies by transforming its modules and reloads once it has prebundled
  them, which destroys the execution context under a reader arriving mid-flight.
  A developer's own server was warmed the last time they opened it; a test that
  hits a cold one every run has to warm it deliberately.
