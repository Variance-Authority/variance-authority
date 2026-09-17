# incumbent-case

**[Variance Authority](../../README.md)** is a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source — the component that
drew the pixels and the `file:line` it was written at.

This case puts it head to head with the screenshot tool most teams already have:
a real `toHaveScreenshot`, run by a real `playwright test`, on the same page
Variance Authority reads.

Not our model of a competitor. `@playwright/test` is installed here, its runner
executes [`src/incumbent.spec.ts`](src/incumbent.spec.ts) in its own process, and
what this case reads afterwards is the report that run wrote. The comparator, the
thresholds, the size-mismatch behaviour, the missing-baseline behaviour and the
wording of every failure are Playwright's own.

That is the whole reason for the shape. A head-to-head against a reimplementation
measures the reimplementation — the same objection
[`storybook-case`](../storybook-case) raises about fixtures, and the same answer:
the only arrangement in which we can be **wrong** is the one where the other side
is real.

Run it and you see four things printed: a scoreboard over eight declared edits, a
render-only inspection, a migration read straight off the baselines Playwright
recorded, and a locale layout comparison. Every number in them comes from the
incumbent's own runner and from the same page Variance Authority reads.

The scope is eight declared scenarios on one Mac and one Chromium. It says
nothing about a hosted review product, a browser fleet, or a representative win
rate.

### The two sides, and what they are called here

- **the incumbent** — `@playwright/test`'s `toHaveScreenshot`, run in two
  configurations: `defaults` (shipped settings, any differing pixel fails) and
  `tolerant` (`maxDiffPixelRatio: 0.01`).
- **ours** — Variance Authority, reading the same page in the same browser.

A **subject** is one named UI state you asked for and can ask for again — here,
one panel at one 420×312 clip — captured and compared under an id you choose.

## Why this incumbent

Because it is the free one that is already installed, and because its comparator
is the one behind most of the market. `pixelmatch` is what Playwright's
`toHaveScreenshot` uses, what `jest-image-snapshot` uses, and what several hosted
products use underneath. Beating a bespoke differ would prove nothing about any
of them; this measurement is against the algorithm they share.

**What it therefore does not cover** is the half of a hosted product that is not
a comparison: a review UI, an approval workflow across a team, a cross-browser
grid, change detection at repository scale. Those are real, this case says nothing
about them, and [`../README.md`](../README.md) says so plainly.

## Running it

You need a checkout of this repository, `yarn install`, and Chromium. Everything
below is run **from the repository root**. The package is `private`, part of the
workspace, and not published.

```bash
npx playwright install chromium
yarn workspace @variance-authority/case-incumbent incumbent
```

The `incumbent` script ([`scripts/incumbent.mjs`](scripts/incumbent.mjs)) builds
the page bundle with esbuild and runs the incumbent in the two phases a team runs
it in — record on the trunk, compare on the branch:

```
CASE_VARIANT=before playwright test --update-snapshots
CASE_VARIANT=after  playwright test
```

The second phase **exits non-zero, and is supposed to**: seven of the sixteen
runs (eight scenarios × two configurations) are meant to fail. It leaves its
report at `incumbent/results.json` and its baselines under `incumbent/baselines/`,
neither of which is committed. Then, still from the repository root:

```bash
yarn vitest run cases/incumbent-case/src/replacement.chromium.test.ts
yarn vitest run cases/incumbent-case/src/migration.chromium.test.ts
yarn vitest run cases/incumbent-case/src/locale.chromium.test.ts
```

The first two read that report; the third asks a question of one render and needs
only the bundle and the browser. All three skip loudly, with the command
attached, when the browser, the bundle or the incumbent's report is missing, or
when the bundle is older than its sources. A silently skipped head-to-head reads
in a summary exactly like one that ran and agreed.

The other files in this directory: [`src/scenarios.ts`](src/scenarios.ts) (the
corpus, declared before either side ran), [`src/surface.tsx`](src/surface.tsx)
(the one component tree every variant is a prop on),
[`src/incumbent.spec.ts`](src/incumbent.spec.ts) (what Playwright's runner
executes), [`src/incumbent-report.ts`](src/incumbent-report.ts) (the reader for
`results.json`), [`src/replacement-arm.ts`](src/replacement-arm.ts) and
[`src/page-agent.ts`](src/page-agent.ts) (our side of the run),
[`page/case.html`](page/case.html), and
[`playwright.config.ts`](playwright.config.ts), which declares the two
configurations as two Playwright projects.

## One page, one clip, one mount

Both sides navigate to [`page/case.html`](page/case.html) over `file://` and
observe `#subject`. The incumbent screenshots it; we screenshot it too, and then
keep reading.

Every variant is a **prop on one component tree**, never a second copy of the
markup — see [`src/surface.tsx`](src/surface.tsx). Two hand-written copies of a
panel would make every measurement a story about which copy drifted.

Four of the eight edits are required to paint identical pixels, and that is not a
trick played on the camera. Each is the change a developer actually makes: a
`<h2>` becomes a styled `<div>` because the size was wanted elsewhere, a
`<button>` becomes a `<div>` because it was fighting a layout. Both are copied
across faithfully — which is exactly why they render the same, and exactly why
they ship.

## The corpus

Ground truth is **not** *"did the image change"*. It is *must a reviewer be
told?*, declared with its argument in [`src/scenarios.ts`](src/scenarios.ts)
before either side ran. Those two questions come apart in both directions, and
every row where they do is a row where one of the two tools is wrong.

| scenario | the edit | must a reviewer be told? |
|---|---|---|
| `label-dropped` | remove `aria-label` from an icon-only control | **yes** — the action is unreachable to anyone not looking at it |
| `heading-demoted` | `<h2>` → styled `<div>` | **yes** — the outline loses a level |
| `control-devolved` | row `<button>` → `<div onClick>` | **yes** — not focusable, no role, ignores Enter |
| `indicator-dropped` | remove the unsaved-changes dot | **yes** — a status affordance vanishes |
| `space-token-nudged` | spacing token 12px → 14px | **yes** — and the question is what you are handed |
| `row-added` | a fourth row, so the panel grows | **yes** — content changed |
| `unseen-subject` | a panel nobody has a baseline for | **no** — and not a pass either |
| `note-reindented` | a formatter wraps the note's inline children | **no** — nothing renders differently |

## The scoreboard

Printed by `replacement.chromium.test.ts`, verbatim, on one Mac and one Chromium
at a 420×312 clip:

```
scenario            ground truth  incumbent (defaults)  incumbent (tolerant)  ours         and we name
------------------  ------------  --------------------  --------------------  -----------  --------------
label-dropped       regression    miss                  miss                  hit          IconButton
heading-demoted     regression    miss                  miss                  hit          Heading
control-devolved    regression    miss                  miss                  hit          RowAction
indicator-dropped   regression    hit                   miss                  hit          Indicator
space-token-nudged  regression    hit                   hit                   hit          Panel, Toolbar
row-added           regression    hit                   hit                   hit          Total, Panel
unseen-subject      no defect     deferral              deferral              deferral     no baseline
note-reindented     no defect     hold                  hold                  false alarm  Note

  incumbent (defaults)  1 deferral, 3 hit, 1 hold, 3 miss
  incumbent (tolerant)  1 deferral, 2 hit, 1 hold, 4 miss
  ours                  1 deferral, 1 false alarm, 6 hit

--- and what an editor can open
  IconButton src/surface.tsx:163
  Heading src/surface.tsx:153
  RowAction src/surface.tsx:237
  Indicator src/surface.tsx:192
  Panel src/surface.tsx:339
  Toolbar src/surface.tsx:219
  Total src/surface.tsx:323
  Note src/surface.tsx:307
  Row src/surface.tsx:249
```

The five marks are scored from the ground truth and what the tool said, never
declared:

| mark | ground truth | what it said |
|---|---|---|
| `hit` | regression | told the reviewer — correctly red |
| `miss` | regression | said nothing — the build is green and the defect ships |
| `hold` | no defect | said nothing — correctly quiet |
| `false alarm` | no defect | told the reviewer anyway |
| `deferral` | either | no baseline existed, and it said so instead of answering |

`deferral` is a third outcome rather than a pass or a fail: a tool that says
*there is no baseline for this* has done something a tool reporting a pass has
not.

Two configurations, because running one would be a straw man whichever it was.
`defaults` is what `@playwright/test` ships — no tolerance at all, so a single
differing pixel fails, which no real suite survives for long. `tolerant` sets
`maxDiffPixelRatio: 0.01`, which is what teams reach for when antialiasing starts
costing them mornings.

### 1. Three rows no threshold reaches

`label-dropped`, `heading-demoted` and `control-devolved` are missed by **both**
incumbent configurations, and that is not a tuning problem. There is no
threshold, no comparator and no tolerance that finds a change which never reached
a pixel: the evidence is absent from the representation. Every raster tool on the
market shares this, because it is a property of comparing images and not of any
particular product.

We answer all three **without consulting an image on either side** — asserted as
`pixels: 0, semanticOnly: true`, not claimed. That is the economic argument in its
honest form: not *"we are faster"*, but *nothing these edits changed was ever
visible, so no screenshot was needed to decide them.*

One of the three is also reachable with no baseline at all — the same run prints
what a single render says on its own:

```
--- inspection, no baseline consulted
  label-dropped        [control-without-name] <button> is a button with no accessible name — IconButton
```

The fair objection is that a team would catch these with `jest-axe` or a DOM
snapshot. True — and that is a second tool, a second suite and a second baseline
to keep. The claim here is one observation answering both questions.

### 2. The tolerance is 36× larger than the regression

```
tolerance          maxDiffPixelRatio 0.01 of 420×312 = 1310px
the indicator      36px
headroom           36× — the regression fits 36 times inside the tolerance
```

`indicator-dropped` is the row the two configurations disagree on, and the
disagreement is the argument. The tolerance is a fraction of the **image**; a
regression is a fraction of a **component**. The two are measured on scales that
have nothing to do with each other, so the smaller and more precise the
affordance, the safer it is from being noticed — and nothing in the output says
which of the two a tolerance just absorbed.

The dot's removal moves nothing around it, on purpose. If it reflowed the
toolbar, the diff would be the reflow and a pixel differ would catch it easily,
which would make this a measurement of layout movement rather than of how small a
real regression can be.

### 3. A number is terminal; a mask is not

`space-token-nudged` and `row-added` are caught by everything. They are in the
corpus for what happens next. Both make the panel taller — 312px to 338px and to
359px — so both are size mismatches, and the incumbent answers each of them with
two dimensions and one count:

```
space-token-nudged   Expected an image 420px by 312px, received 420px by 338px.
                     5466 pixels (ratio 0.04 of all image pixels) are different.
```

5466 is Playwright's count over its own padded canvas; §"What the import costs"
below reports 5908 for the same pair, which is *our* count under our policy over
the same baseline. Neither number is wrong and the gap is not the point — the
point is that neither of them can be assigned to anyone, so the only available
response is to open the
image and look — which is the expensive act the tool was meant to replace, and
where review blindness comes from. A mask clusters into regions, the regions join
the box tree, the tree knows which component produced each node, and the
component resolves to a file an editor opens:

```
IconButton src/surface.tsx:163     Indicator  src/surface.tsx:192
Heading    src/surface.tsx:153     Panel      src/surface.tsx:339
RowAction  src/surface.tsx:237     Row        src/surface.tsx:249
```

Ranking comes from the semantic tier rather than from area, for the reason
[`examples/todomvc`](../../examples/todomvc) measured: area ranks the displaced
above the displacer.

### 4. The row where we lose

`note-reindented` renders identically and moves our hash. Leading and trailing
whitespace inside a block collapses away when it is painted; telling a block
context from an inline one needs a layout engine, and the normalizer does not
consult one even under `chromium`. **The camera is right and we are wrong.**

It is asserted as a false alarm, so the day somebody fixes it this suite goes red
and says so. A comparison that only ever finds in its own favour is an
advertisement.

### 5. The row where both are right

`unseen-subject` has no baseline, and neither tool calls it a pass. Playwright says
*"A snapshot doesn't exist … writing actual"* and fails; we say `new`. Both are
correct, and it is in the corpus because a comparison that lists only
disagreements is not a comparison.

Worth naming, on both sides: Playwright **writes** that missing baseline while
failing, so re-running the same job turns red into green with nobody having looked
at anything. We have the same hole from the other end —
[`accept --all`](../../packages/cli/README.md) does not distinguish a new baseline
from a changed one. Neither of us should.

## Can a team actually leave?

[`src/migration.chromium.test.ts`](src/migration.chromium.test.ts) asks the other
half of "replace", which is the half a better answer does not settle. A tool
nobody can migrate *to* has replaced nothing.

It starts from the artifact a team already has — the PNGs
`playwright test --update-snapshots` wrote — and does not re-record anything.

From the repository root, after the incumbent run above:

```bash
yarn vitest run cases/incumbent-case/src/migration.chromium.test.ts
```

**Their baselines are ordinary PNGs, so there is nothing to convert.** The reading
end takes one as it is and produces what the count could not, on the first run:

```
--- space-token-nudged, read from a baseline Playwright recorded
  their baseline      incumbent/baselines/strict/space-token-nudged.png (22933 bytes)
  what it says        5908 pixels changed
  what we add         16 region(s), 0 of them off-tree
  cause        1151px — Panel          src/surface.tsx:339
  cause        1128px — Heading        src/surface.tsx:153
  cause         463px — Panel          src/surface.tsx:339
  cause         438px — Panel          src/surface.tsx:339
  cause         212px — Total          src/surface.tsx:323
  cause          54px — IconButton     src/surface.tsx:163
```

The regions, the names and the files are what the import gives you. The
cause-first *order* is not: producing that needed a live `before` capture, which
a migrating subject does not have — see below.

That format is not a format, and that is the point. A tool whose baselines are a
proprietary blob, or live only behind an API, is a tool whose exit cost is a
re-recording of every subject — which is what keeps teams where they are.

### What the import costs, measured

**A PNG carries no identity.** Our durable baselines are partitioned by renderer
identity so a run on a different machine is `incomparable` — one sentence —
rather than every subject failing for reasons nobody can attribute. An
imported baseline states no engine, no scale factor, no fonts and no platform, so
it can only be compared *by assumption*, and the verdict that guards a wrong
assumption is unavailable for as long as the import lasts. The same run prints
the absences:

```
--- what an imported baseline cannot say
  engine             (absent) — which chromium painted it
  deviceScaleFactor  (absent) — 1x and 2x are different baselines
  fonts              (absent) — a substituted font compares unchanged,
  platform           (absent)   which is true and worthless
  the document       (absent) — so no cheap tier, and no ordering
```

That is not a defect in their design. A screenshot assertion has no identity to
record because it never compares across machines by construction — the baseline
and the run are the same CI image, or the suite is already red. It becomes a cost
the moment the baseline outlives that assumption.

**A PNG is also not a semantic baseline**, and this is the sharper cost.
Attribution needs one snapshot, of the *current* state, so region names and files
survive the import intact. **Ranking** needs a baseline document, because cause
and collateral are decided by what two documents say and not by where pixels are.
So an imported subject can only be ordered by area — and area is the ordering
[`examples/todomvc`](../../examples/todomvc) measured as backwards. The same 16
regions, ordered both ways:

```
--- the same regions, ordered two ways
  by area (what an import can do)      Panel > Heading > Row > Row > Panel > Panel > Row > … > IconButton
  by cause (needs a semantic baseline) Panel > Heading > Panel > Panel > Total > IconButton > Indicator > …
  same order?                          no
```

So the honest migration story is a generation, not a switch: **import to get
moving, and let the imported baselines age out** as subjects are re-recorded
under an identity. Until a subject is re-recorded it gets regions, names and
files, and neither `incomparable` nor a cause-first ordering.

*Not built: a foreign-baseline reader in [`store`](../../packages/store). Reading
a directory of PNGs is `readFileSync`, which is why this case does it inline
rather than shipping a package for it — but the generation-tracking above is real
product surface and does not exist.*

## What the run corrected

The corpus was declared first and the run disagreed with it twice. Both
corrections are in the source with the reason attached, because a prediction
quietly edited to match its result is not a prediction.

**`row-added` was declared as a refusal to measure.** Older write-ups of
`toHaveScreenshot` describe a hard failure on a size mismatch with no comparison
performed. What 1.62 actually does is print both dimensions *and* a count over the
padded canvas — `Expected an image 420px by 312px, received 420px by 359px. 1965
pixels … are different.` So the scenario does not carry the property it was
declared for, and sits alongside `space-token-nudged` as a row about
interpretability rather than refusal.
This is precisely what running their runner buys over reading their docs.

**`indicator-dropped` was declared to name `Toolbar`.** It names `Indicator` —
attribution resolves the component that *owns* the node, not the one that
contains the region. More precise than the declaration, so the declaration moved.

## What this does not establish

- **One machine.** One Mac, one Chromium, one clip size. Every pixel count here
  moves on a different machine, and the arithmetic in §2 moves with the image
  size.
- **One incumbent.** `pixelmatch` at Playwright's defaults. Applitools' and
  Percy's comparators are not this, and are not measured.
- **Eight scenarios, chosen by us.** They are the ones we believe separate the
  tools, which is not the same as a representative sample of a real suite.
- **Nothing about scale.** Eight subjects. This case does not establish that
  attribution holds at three hundred.
