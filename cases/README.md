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
| [`storybook-case`](storybook-case) | a real Storybook, built by `storybook build`, read from outside | the readiness gap, reproducibly: `storyRendered` captures `loading…`, a declared marker captures the component |
| [`incumbent-case`](incumbent-case) | a real `@playwright/test`, running its own `toHaveScreenshot` in its own process | eight declared edits; 3 of them are missed by every configuration the incumbent has, and 1 is a false alarm of ours |

## Where replacement stands

From [`incumbent-case`](incumbent-case), measured on one Mac and one Chromium:

```
  incumbent (defaults)  3 hit, 3 miss, 1 hold, 1 deferral
  incumbent (tolerant)  2 hit, 4 miss, 1 hold, 1 deferral
  ours                  6 hit, 1 false alarm, 1 deferral
```

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
3. **A count is terminal and a mask is not.** *5446 pixels changed* cannot be
   assigned to anyone, so the only response is to open the image and look — the
   expensive act the tool was meant to replace. The same comparison read further
   is `Heading src/surface.tsx:87`.
4. **We false-alarm where the camera is right.** A reindented block moves our hash
   and renders identically. Asserted as a failure, so the day it is fixed the
   suite goes red and says so.

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
measurement, and it is labelled as one.

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
agreed.
