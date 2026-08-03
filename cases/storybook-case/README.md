# storybook-case

**A real Storybook, built by Storybook, read from the outside.**

Not a fixture shaped like one. `storybook build` produces `storybook-static/` and
the adapter is pointed at the `index.json` that Storybook wrote — because an
adapter tested against an index *we* wrote is an adapter tested against our own
assumptions about the format.

## Running it

```bash
yarn workspace @variance-authority/case-storybook build-storybook
```

```bash
yarn vitest run cases/storybook-case/src/storybook.chromium.test.js
```

The test serves `storybook-static` over a plain node HTTP server, so nothing
depends on a dev server being up.

To look at it by hand:

```bash
yarn workspace @variance-authority/case-storybook storybook
```

## What is in the stories

A small design system — `Button`, `Stack`, `Card`, `Spinner`, `Clock`,
`AsyncPanel` — chosen so the eight stories cover the cases that actually decide
whether an adapter is any good:

Eight stories, covered by **one navigation**:

| story | what it is for |
|---|---|
| `Button — primary`, `Button — secondary` | the ordinary path |
| `Card — with actions`, `Card — rebranded`, `Composed` | `Button` again, so no subject covers it alone — these five are what a `Button` edit moves |
| `Loading` (`Spinner`) | something that will not hold still |
| `Ticking` (`Clock`) | content that changes because time passed, not because code did |
| `Deferred` (`AsyncPanel`) | settles *after* Storybook says it is done |

Those last three are the three that hold when `Button` changes.

The adapter's remaining path — a story that throws, reported as an error overlay
with the story's own stack rather than as a timeout — has no standing story here;
it was exercised against a real build failure instead, below.

## The finding this case exists to have produced

`AsyncPanel` demonstrates the readiness gap, **reproducibly rather than
flakily**:

- with Storybook's own `storyRendered` signal, the capture is of `loading…`
- with a declared `readySelector`, the capture is of the component

Which is the whole argument for a declared marker over a framework signal, made
by a component rather than by an assertion. A story that never attaches its
marker times out and says which selector it waited for — there is no fallback,
because falling back is how you photograph a spinner and call it a component.

## Driving the CLI end to end

The adapter reads a Storybook. This runs the whole tool over one.

```bash
yarn workspace @variance-authority/case-storybook build-storybook
yarn workspace @variance-authority/case-storybook build-storybook:changed
yarn build
```

```bash
yarn vitest run cases/storybook-case/src/cli.chromium.test.js
```

Four steps, which is the workflow a team actually runs:

| step | verdicts | exit |
|---|---|---|
| `variance run` on a fresh checkout | 8 new | **1** |
| `variance accept --all` | 8 accepted | 0 |
| `variance run` again | 8 unchanged, *nothing to review* | 0 |
| `variance run` on the changed build | 3 unchanged, **5 changed** | **1** |

The last row is the one worth reading. `Button` appears in five of the eight
stories, and the run finds exactly those five — the three that hold are `Spinner`,
`Clock` and `AsyncPanel`, none of which render one. The report resolves to source:

```
[changed] story:case-surface--button-primary
1356 pixel(s) differ across 1 region(s), and the subject resized from 1024×76 to 1024×82
  collateral 1356px at 17,17 113×48 — Tokens
      src/ds.jsx:26
```

**The edit is not threaded as a prop.** `VITE_CASE_MUTATION=wide-button` produces
a second Storybook in which `Button` declares different padding, so nothing in
this repository is modified and restored to run the comparison — and, more
importantly, `Button`'s incoming props do not move. A prop switch would make every
source edit look like a composition change and root it at whichever component
happens to be the story's entry point. See
[`examples/todomvc/src/code-mutation.ts`](../../examples/todomvc/src/code-mutation.ts),
which records that mistake being made and undone.

### The collector is the operator's half, written out in full

[`collector/index.mjs`](collector/index.mjs) is the 234 lines
`variance.config.json` names; [`collector/`](collector) is 341 lines across three
files, once the page agent and its bundler are counted. That is the size of the
half an adopter writes.
The CLI supplies the generic half — read `index.json`, apply exclusion policy,
plan — and this supplies what only this project can: it serves its own build,
declares which stories have their own readiness marker, and indexes its own
source for component→file. That seam exists because a CLI that guessed any of
those would need a plugin system whose failures are undebuggable from either
side.

## What it caught

A story that throws is reported as `errored` with its own stack rather than as a
timeout — the distinction that tells an operator to read a stack trace instead of
raising a readiness timeout. The case exercised it against a real
`React is not defined` (a missing `esbuild.jsx: 'automatic'` in `viteFinal`).

**The first real `variance run` found five defects, all since fixed.** None was
reachable from `packages/cli/src/commands/run.test.ts`, which injects a fake
`Collector` and a fake `Renderer` — the right way to test the loop, and no way at
all to test the workflow.

| # | what | why the unit tests could not see it |
|---|---|---|
| 1 | **The run never exited.** `deps.renderer()` is a factory and nothing closed what it opened, so a correct report printed and the process sat holding a browser | a fake renderer costs nothing to leave open |
| 2 | **`stabilization` was dropped by the identity wire codec**, so `accept` stored a baseline under a shorter digest than the next `run` looked it up with — every subject `incomparable`, forever, on one machine | the store suites build identities by hand; the run suite's fake renderer stamps none |
| 3 | **The refusal named the same machine on both sides**, because `describeIdentity` printed neither the fonts nor the recipe — the two fields the digest covers and the sentence omitted | which is exactly how (2) stayed invisible |
| 4 | **The coverage section printed twice**, by the CLI and by the MCP tool it delegates to | every assertion used `toContain`, which the first copy satisfies |
| 5 | **A production Storybook build minifies**, so attribution reported `1356 pixel(s) differ … in a` | every other subject in this repository is built by esbuild in development mode, where names survive |

(5) is not a defect in this project and is the one worth passing on: **component
attribution needs a build that preserves function names.** React reads a display
name off the function, minification renames it, and the chain then produces a
complete, confident report naming something that appears in no source file — which
is worse than naming nothing. [`.storybook/main.js`](.storybook/main.js) sets
`esbuild.keepNames: true` and says so at length. Any project wanting component
names in its reports pays the same, and nobody would guess it.

## The gap this case leaves open

**Nothing on the durable path is a `cause`.** Every region above reads
`collateral`, and the largest one belongs to `Tokens` — the wrapper the edit
displaced — rather than to `Button`, which is the edit.

That is not attribution failing. Regions land in the tree, name a component and
resolve to a file. It is *ranking* failing, and for a reason with a name:
separating cause from collateral needs the previous revision's **snapshot**, and a
durable run has a baseline image without one. So the ordering falls back to area,
which [journal 0013](../../docs/context/journal/0013-observability.md) measured as
backwards.

It is the same gap [`cases/incumbent-case`](../incumbent-case) measures from the
other end when it imports a foreign baseline: *a PNG is not a semantic baseline.*
Here it is not an import problem — it is that nothing in the durable pipeline
carries one. The test asserts the current behaviour, so the day one is carried it
goes red and says so.
