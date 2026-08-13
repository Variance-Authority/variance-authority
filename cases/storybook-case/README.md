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
`AsyncPanel`, `Panel`, and three Suspense trees — chosen so the twelve stories
cover the cases that actually decide whether an adapter is any good.

Twelve stories, covered by **one navigation**:

| story | what it is for |
|---|---|
| `Button — primary`, `Button — secondary` | the ordinary path |
| `Card — with actions`, `Card — rebranded token`, `Stack — composed page` | `Button` again, so no subject covers it alone — these five are what a `Button` edit moves |
| `Spinner — mid animation` | something that will not hold still |
| `Clock — ticking` | content that changes because time passed, not because code did |
| `AsyncPanel — settles late` | settles *after* Storybook says it is done |
| `Panel — revealed by its play function` | a subject that does not exist until an interaction runs |
| `Suspense — settles` | a boundary no marker could cover: the component that would carry one has not rendered |
| `Suspense — waterfall` | a boundary that only exists once the first one resolves, so one clean reading is not enough |
| `Suspense — stalled` | a boundary that never resolves, which is a flake source and is refused unless declared |

Those last seven are the seven that hold when `Button` changes.

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
| `variance run` on a fresh checkout | 12 new | **1** |
| `variance accept --all` | 12 accepted | 0 |
| `variance run` again | 12 unchanged, *nothing to review* | 0 |
| `variance run` on the changed build | 7 unchanged, **5 changed** | **1** |

The last row is the one worth reading. `Button` appears in five of the twelve
stories, and the run finds exactly those five — the seven that hold are
`Spinner`, `Clock`, `AsyncPanel`, the disclosure a play function opens and the
three Suspense trees, none of which render one. The three Suspense stories
holding still is the wait working: two of them arrive after Storybook says the
story is done, and would otherwise record a skeleton on one run and a component
on the next. The report resolves to source:

```
[changed] story:case-surface--button-primary
1320 pixel(s) differ across 2 region(s) in Button, and the subject resized from
136×76 to 148×82

  cause      1025px at 17,17 114×48 — Button
      in button "Continue"
      cases/storybook-case/src/ds.jsx:51
      shape v1:91eb0e5b6b0e067766e31876a572b70b
  cause      295px at 37,32 69×15 — Button
      in button "Continue"
      cases/storybook-case/src/ds.jsx:51
      shape v1:b4e5b4bc82d098302edb209a111cf07e
```

The edit is to `Button`. The report says `Button`, at `Button`'s file — `ds.jsx:51`
is the component, not `ds.jsx:26`, which is the `Tokens` wrapper it is rendered
inside. That sentence is the whole claim, and this case is where it is checked
against a real binary rather than argued.

**The edit is not threaded as a prop.** `VITE_CASE_MUTATION=wide-button` produces
a second Storybook in which `Button` declares different padding, so nothing in
this repository is modified and restored to run the comparison — and, more
importantly, `Button`'s incoming props do not move. A prop switch would make every
source edit look like a composition change and root it at whichever component
happens to be the story's entry point. See
[`examples/todomvc/src/code-mutation.ts`](../../examples/todomvc/src/code-mutation.ts),
which records that mistake being made and undone.

### The collector is the operator's half, and it is five lines

[`collector/index.mjs`](collector/index.mjs) is **five lines of code**; everything
else lives in
[`@variance-authority/storybook-collector`](../../packages/storybook-collector).
Writing the same thing by hand costs 234 lines, in a directory of 341 across
three files once the page agent and its bundler are counted — and that 341 is a
boundary drawn one step too far out. A story index is a documented artifact and a
preview owns its own mount, so serving the build, injecting the bundle, driving
the channel, acquiring and normalizing are Storybook's contract being re-typed
rather than knowledge this project holds.

What is genuinely this project's is the residue: which story defers its own
readiness and by what marker, and where its components live.

The seam is the same either way — the config names a module, the module exports a
function, and nothing is discovered. A CLI that *guessed* either of those two
facts would need a plugin system whose failures are undebuggable from either
side. `cli.chromium.test.js` is written against the seam and not against the
collector, so which side of it does the work is invisible to the test.

## What it caught

A story that throws is reported as `errored` with its own stack rather than as a
timeout — the distinction that tells an operator to read a stack trace instead of
raising a readiness timeout. The case exercises it against a real
`React is not defined` (a missing `esbuild.jsx: 'automatic'` in `viteFinal`).

**Five defects sit in the gap this case covers**, and none is reachable from
`packages/cli/src/commands/run.test.ts`, which injects a fake `Collector` and a
fake `Renderer` — the right way to test the loop, and no way at all to test the
workflow.

| # | what | why the unit tests cannot see it |
|---|---|---|
| 1 | **The run never exited.** `deps.renderer()` is a factory and nothing closed what it opened, so a correct report printed and the process sat holding a browser | a fake renderer costs nothing to leave open |
| 2 | **`stabilization` was dropped by the identity wire codec**, so `accept` stored a baseline under a shorter digest than the next `run` looked it up with — every subject `incomparable`, forever, on one machine | the store suites build identities by hand; the run suite's fake renderer stamps none |
| 3 | **The refusal named the same machine on both sides**, because `describeIdentity` printed neither the fonts nor the recipe — the two fields the digest covers and the sentence omitted | which is exactly how (2) stayed invisible |
| 4 | **The coverage section printed twice**, by the CLI and by the MCP tool it delegates to | every assertion used `toContain`, which the first copy satisfies |
| 5 | **A production Storybook build minifies**, so attribution reported the pixel count `… in a` | every other subject in this repository is built by esbuild in development mode, where names survive |

(5) is not a defect in this project and is the one worth passing on: **component
attribution needs a build that preserves function names.** React reads a display
name off the function, minification renames it, and the chain then produces a
complete, confident report naming something that appears in no source file — which
is worse than naming nothing. [`.storybook/main.js`](.storybook/main.js) sets
`esbuild.keepNames: true` and says so at length. Any project wanting component
names in its reports pays the same, and nobody would guess it.

## What the line above costs

**Three independent things have to hold for the report to say `Button` rather than
`Tokens`** — the wrapper the edit displaces rather than the component that was
edited. Any one failing produces a confident wrong name, which is why a
measurement can look straight at this line and see nothing:

1. **A durable run has to know what caused anything.** Separating cause from
   collateral needs the previous revision, and a stored baseline is an image. A
   baseline carries the component hashes of the document that painted it
   ([ADR-0027](../../docs/context/adr/0027-a-baseline-carries-what-its-document-said.md)),
   so the run can see that `Button`'s own content moved and `Tokens`'s did not.
2. **The geometric join has to be able to place it.** `Tokens` wraps `Button` and
   measures `454.34,359 115.33×50` — *byte-identical* to it, because a block
   wrapper is exactly as big as its only child. Neither box is tighter, so the
   tie falls to the walk, and a document-order walk puts the wrapper first. One
   character in `packages/core/src/attribute/region.ts` decides it.
3. **The image has to be of the page the subject was acquired from.** Storybook's
   preview centres the story with a rule on `body`, so a render that carries only
   the subject's own subtree paints it full-width and every coordinate is then
   converted between two layouts. The document carries the frame the page had
   ([ADR-0028](../../docs/context/adr/0028-the-frame-is-part-of-the-page.md)), and
   `subject-size-diverged` is the detector: the report above says `136×76 to
   148×82` against a subject the page lays out at 147.33 CSS pixels, and the
   warning is silent.

The related gap [`cases/incumbent-case`](../incumbent-case) measures from the other
end: *a PNG is not a semantic baseline*, and an imported foreign image
carries no hashes, so it ranks by area — which
[journal 0013](../../docs/context/journal/0013-observability.md) measured as
backwards.
