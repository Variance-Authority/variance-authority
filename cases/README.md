# Cases

**A case is a confrontation with something this project did not author.**

That is the whole distinction from [`examples/`](../examples). The examples are
our corpus: we wrote the components, we declared the ground truth, we chose the
mutations. They are how the pipeline is *measured*, and they are also how a
measurement quietly becomes circular — [journal
0008](../docs/context/journal/0008-sessions.md) records a fixture that applied
token overrides inline on the subject root and thereby routed around a hole where
`:root` tokens reached nothing. A fixture convenient in the same way the
implementation was convenient tested nothing.

A case removes that convenience. Storybook writes the index; Playwright writes the
baselines and the failure messages. We can be **wrong** here, which is the only
property that makes an agreement worth anything.

| case | what it confronts | what it produced |
|---|---|---|
| [`storybook-case`](storybook-case) | a real Storybook, built by `storybook build`, and the whole CLI run over it | the readiness gap, reproducibly — and **five defects in the first real `variance run`**, three of which made durable mode unusable |
| [`incumbent-case`](incumbent-case) | a real `@playwright/test`, running its own `toHaveScreenshot` in its own process | eight declared edits; 3 of them are missed by every configuration the incumbent has, and 1 is a false alarm of ours. Plus two questions no comparison can be asked at all — see below |

Both halves matter and they are different questions. One asks *do we answer
better*. The other asks *does the thing run* — and a tool that answers better and
has never been executed replaces nothing.

## Where replacement stands

From [`incumbent-case`](incumbent-case), measured on one Mac and one Chromium:

```
  incumbent (defaults)  3 hit, 3 miss, 1 hold, 1 deferral
  incumbent (tolerant)  2 hit, 4 miss, 1 hold, 1 deferral
  ours                  6 hit, 1 false alarm, 1 deferral
```

Eight edits, scored against *must a reviewer be told?* — **hit** told them and
should have, **miss** stayed silent and should not have, **hold** stayed silent
correctly, and **false alarm** spoke up over nothing. **Deferral** is neither: it
is `unseen-subject`, a panel with no baseline, where both arms decline to reach a
verdict at all and both are right to. It is one row in every column, so it moves
no comparison — it is in the corpus because a scoreboard that lists only the rows
that separate the tools is not a scoreboard.

Three claims come out of that, and one concession:

1. **A whole category is unreachable by any raster tool.** An `aria-label`
   deleted, a heading demoted, a `<button>` devolved to a `<div>` — none reach a
   pixel, so no threshold, comparator or tolerance finds them. We settle all
   three with no image consulted on either side. This is a property of comparing
   images, not of any product, so it holds against every incumbent on the list
   below.
2. **A tolerance is measured against the wrong thing.** `maxDiffPixelRatio: 0.01`
   of a 420×312 clip is 1310px of licence; the status indicator that vanished is
   36px. The regression fits 36 times inside the setting that makes the suite
   survivable, and nothing in the output says which of the two it just absorbed.
3. **A count is terminal; a region has an owner.** *5446 pixels changed* cannot be
   assigned to anyone, so the only response is to open the image and look — the
   expensive act the tool was meant to replace. The same comparison read further
   is `Heading src/surface.tsx:153`.
4. **We false-alarm where the camera is right.** A reindented block moves our hash
   and renders identically. Asserted as a failure, so the day it is fixed the
   suite goes red and says so.

And from [`storybook-case`](storybook-case), the workflow rather than the
comparison — over a Storybook this project did not author:

```
variance run     on a fresh checkout          8 new                exit 1
variance accept --all                         8 accepted           exit 0
variance run     again                        8 unchanged          exit 0
variance run     one component edited         3 unchanged, 5 changed   exit 1
```

The last row finds exactly the five stories that render the edited component.
**What it cannot do yet is say which of the named components is the cause** —
that needs the previous revision's snapshot, and a durable run has a baseline
image without one, so every region reads `collateral` and the ordering falls back
to area. The same sentence `incumbent-case` reaches from the other end: *a PNG is
not a semantic baseline.*

## Two questions that are not comparisons

Both cases above ask *did the tool report the change*. From the same surface,
`incumbent-case` also asks two questions that have no baseline in them, because
they are the questions an image cannot be asked:

**What is wrong with this render on its own?** A control that never had an
accessible name compares equal to itself forever, so approving the first baseline
approves the defect. Of the three accessibility regressions no `toHaveScreenshot`
configuration detects, inspection reaches **one** from the broken render alone —
and the case asserts that it reaches only one. A `<div>` with no role is not a
defect in any render taken by itself; it becomes one against the `<button>` it
replaced. Inspection and comparison catch different things and neither contains
the other.

**What happens in another language?** One panel, English and German, real
Chromium layout:

```
  translated strings   16
  identical strings    2
  widest growth        2.02× at RowAction
  overflows at 420px   0
  overflows at 300px   2
```

The two identical strings are one node's accessible name and its `title`, which
carry the same untranslated text — reported as **one** finding, because reporting
both would be reporting one missing translation twice. So: one string left in
English, found in two places. The first version of the rule read text nodes and
found nothing, which is the correction that made it useful: the strings that get
forgotten are the ones that are not text nodes. And the overflow answer
depends on the container, not on the translation, which is why no expansion ratio
could have produced it.

**Not measured: what the incumbent would do here.** It was not run at two
locales. That its model needs a baseline per locale per subject follows from how
`toHaveScreenshot` is keyed — an argument from the shape of the thing, labelled
as one.

## A case must refuse a stale bundle

`incumbent-case` reads a prebuilt page bundle rather than rebuilding one at test
time, so that both arms observe the same bytes. The cost of that showed up
immediately: a fix in `packages/dom` did not reach the page, and the
head-to-head stayed green against yesterday's implementation for a whole session.

That is a silently skipped case in a different shape — it reads in a summary
exactly like one that ran and agreed. The bundle now writes esbuild's own input
list and the case **refuses to run** when it is older than any of them, naming
the file and the command. Rebuilding instead would be worse: our arm would then
observe a newer page than the one the incumbent recorded its baselines against,
and a head-to-head between two builds measures the builds.

## What is not established here, and cannot be

**The hosted products are not confronted, and this repository will not pretend
otherwise.** Chromatic, Percy and Applitools are half comparison and half
product: a review UI, an approval workflow across a team, a cross-browser grid,
change detection at repository scale, a place for a designer to click "approve".
Nothing in `cases/` says anything about any of that, and a comparison that
scored only the half we happen to have built would be an advertisement.

What *does* carry across is claim 1. Their comparison is a comparison of images,
so the invisible category is invisible to them too, whatever the review UI around
it looks like. That is an argument from the shape of the thing rather than a
measurement.

**One incumbent has actually been run.** `pixelmatch` at Playwright's defaults —
which is also what `jest-image-snapshot` uses, and what several hosted products
use underneath, so beating a bespoke differ would have proven less. It is still
one comparator on one machine against eight scenarios we chose.

**Nothing here is at scale.** Eight subjects. The claims about attribution holding
across three hundred are open in
[`docs/context/checkpoint.md`](../docs/context/checkpoint.md), and no case closes
them.

## Adding a case

Two rules, and they are the reason the directory exists:

1. **The other side must be real.** Its own runner, its own artifacts, its own
   error messages. If the confrontation is against our model of the thing, the
   case measures our model — which is the objection
   [`storybook-case`](storybook-case) makes about fixtures and
   [`incumbent-case`](incumbent-case) makes about reimplementing a competitor.
2. **Declare the expected answer before running it.** In a file, with the
   argument attached, so a disagreement is a finding rather than a scoreboard to
   adjust afterwards. When a run corrects a declaration — and it has, twice —
   the correction is recorded with its reason and not edited away.

Both cases skip loudly, with the command attached, when their prerequisite is
missing. A silently skipped case reads in a summary exactly like one that ran and
agreed — so this sentence is a test rather than a promise: `tools/skips.test.ts`
fails when any browser-gated suite stops announcing itself. It was written because
the sentence was false when it was checked. Six of the ten gated files printed
nothing, three of them carrying a skipped test whose *title* was the remedy, which
reads like an announcement in review and emits nothing under the reporter CI uses.
