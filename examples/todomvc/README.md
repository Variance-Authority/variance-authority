# todomvc

**[Variance Authority](../../README.md)** is a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source — the component that
drew the pixels and the `file:line` it was written at.

This example is the application it is measured on: a small design system, a
TodoMVC built from it, and a set of edits with a declared intent. Three test
files run over that application — one that turns a pixel diff into named
components, one that runs an ordinary screenshot-and-diff pipeline over the same
states so every claim has a measured number beside it, and one that renders a
document acquired in a unit-test process on a different machine.

The fixtures are authored here. What you are looking at is the machinery working
on a codebase small enough to read, not a survey of real-world repositories.

## What is here

| Path | What it is |
| --- | --- |
| [`src/ds/components.tsx`](src/ds/components.tsx), [`src/ds/styles.ts`](src/ds/styles.ts) | The design system: `Stack`, `Text`, `Button`, `TextField`, `Toggle`, `Chip`, `Card`, and the tokens they read |
| [`src/app/todo.tsx`](src/app/todo.tsx) | The TodoMVC built from those components |
| [`src/stories.tsx`](src/stories.tsx) | The 15 UI states everything below is measured over |
| [`src/mutations.ts`](src/mutations.ts) | Nine edits, each declaring the layer it touches and whether it should be visible |
| [`src/observe.chromium.test.ts`](src/observe.chromium.test.ts) | Pixels to code lines |
| [`src/pixel.chromium.test.ts`](src/pixel.chromium.test.ts), [`scripts/pixel-arm.mjs`](scripts/pixel-arm.mjs) | The screenshot-and-diff comparison |
| [`src/offload.chromium.test.tsx`](src/offload.chromium.test.tsx) | Rendering a document somewhere other than where it was acquired |

## Running it

You need Node 22 or newer and Yarn 4 through Corepack. **Every command below
runs from the repository root**, not from this directory — the suites resolve
`examples/todomvc/` relative to the process working directory, and the packages
they import resolve through `dist/`, so the build is not optional.

```bash
yarn install
yarn build
npx playwright install chromium
```

Without Chromium the browser suites skip with a reason rather than fail.

## Pixels to code lines

```bash
yarn vitest run examples/todomvc/src/observe.chromium.test.ts
```

```
--- broken-toggle on page/todos--populated
what a pixel differ reports:  1518 pixels changed
what this reports:            5 region(s)
  cause       915px in 2 region(s) — Text
      src/ds/components.tsx:42
  cause        86px in 2 region(s) — Toggle
      in checkbox "Mark "Prove the tiering" as done"
      src/ds/components.tsx:107
  collateral  517px in 1 region(s) — Stack
      src/ds/components.tsx:27
```

Those line numbers are where the components are declared in
[`src/ds/components.tsx`](src/ds/components.tsx): line 42 is `export function
Text`, line 107 is `Toggle`, line 27 is `Stack`.

Nothing extra is rendered to get there. The comparison stops at a mask instead
of a count; the mask clusters into regions; each region is joined to the
normalized tree of the render — the semantic snapshot, which records for every
node the component that produced it and where that component was written; and
the component resolves to a file and a line. It is the same two screenshots,
read further.

`cause` and `collateral` come from comparing each component's digests across the
two sides: a component whose own content differs edited itself and is a cause; a
component that is byte-identical and whose box merely moved was pushed by
something else, and is collateral.

The distinction is the point. The edit swapped `Toggle`'s native checkbox for a
styled `<div>` carrying the same classes, which moves far more of what sits
around it than of itself: `Text` sits in the same rows, and `Stack` reflows
around both. Ranked by area that report is **wrong** — `Stack` at 517px was
never edited and outranks `Toggle`, which *is* the edit, by 6×. Area measures
displacement, and displacement is largest where the change is not.

## Measured against an ordinary pixel diff

```bash
yarn vitest run examples/todomvc/src/pixel.chromium.test.ts
```

The same states through a plain screenshot-and-diff pipeline — a persistent
Chromium, one screenshot per story per side, `pixelmatch` at its own defaults,
no threshold chosen after seeing the answer. It appears below as the `pixel arm`
column.

Part of what that run prints is the instability table: two runs of the same
commit, nothing changed. It includes the row where **we lose**.

```
INSTABILITY — two runs of the same commit, one thing a pipeline cannot control
  source               pixel arm          ours     absorbed by
  ------------------------------------------------------------------------
  text-smoothing       moves (160px)      holds    construction
  device-pixel-ratio   moves (3005px)     holds    environment-key
  scrollbar            holds              holds    headless-artifact
  clock                moves (68px)       moves    policy
  block-whitespace     holds              moves    nothing
```

`absorbed by` names *how* each source stops costing a review, and no two rows
use the same mechanism:

- **construction** — the semantic snapshot never carried the quantity. Glyph
  rasterization is not a property of the box tree, so there is nothing to
  threshold; it is absent rather than tolerated.
- **environment-key** — the difference is real, and `deviceScaleFactor` is part
  of the identity, so the two runs address different baselines and never meet. A
  pixel differ has the same option and has to be configured to take it.
- **headless-artifact** — **not absorbed by anyone.** Headless Chromium uses
  overlay scrollbars, so the reflow never happens here and *both* pipelines are
  blind to something every headed user sees. Kept in the table because "it only
  flakes in CI" is, for this cause, exactly inverted.
- **policy** — both move and neither is wrong; what differs is the cost of
  silencing it. A pixel differ masks a coordinate region, which silences
  whatever else lands there and breaks when the layout moves; `digestText` masks
  the text node, which follows the content.
- **nothing** — `block-whitespace` reaches the semantic snapshot and is reported
  anyway, while the pixel arm holds. It is in the table because a comparison
  that only lists the rows we win is not a comparison.

The full head-to-head — per-mutation costs, the timing split between
screenshotting and semantic collection, and three probes where the pixel
pipeline is the one that can see — prints from the script directly:

```bash
yarn workspace @variance-authority/example-todomvc pixel
```

```
  WHERE THE TIME GOES — 15 renders per pass, same stories, same page
  mount only                       16ms   1.1 ms/story
  mount + screenshot              997ms   66.4 ms/story
  mount + semantic capture         58ms   3.9 ms/story

  BLIND SPOTS — changes the pixel arm sees
  canvas-repaint    not-in-dom          default     857 px   strict    2031 px
                    semantic renderHash HELD (we are blind)
                    The sparkline now plots the other series. Same element, different bitmap.
```

Add `--write` to dump every PNG and diff into `pixel-out/`.

## Rendering somewhere else

```bash
yarn vitest run examples/todomvc/src/offload.chromium.test.tsx
```

**jsdom describes, Chromium paints.** A document acquired in a unit-test process
renders byte-identically in-process and over an HTTP hop, which is what makes
"acquire here, render on a pinned machine" a wiring decision rather than a
rewrite.

The scope of that: it paints something with the subject's geometry that responds
to its styling, over a socket, byte-identically. That is what offloading needs.
It is not the claim that the image matches the page the document was acquired
from, and nothing here measures that.
