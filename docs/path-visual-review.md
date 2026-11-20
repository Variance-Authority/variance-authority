# Review a visual change

A screenshot suite tells you that pixels differ. A change report from
[Variance Authority](README.md) tells you three more things: which rows content
only moved down, and which your edit drew; what kind of change each region is,
strong or faint, shape or colour; and which component, place in the page and
source line each region comes from. This page shows the three on one recorded run, then orders the steps that
get the same report out of your own suite and a build that gates on it.

Every step runs on your own build machine, against baselines in your own
repository, and links the page that owns it.

## What a change report gives you

The [visual-review example](../examples/visual-review-case/README.md) renders
three pricing cards and makes three edits: a notice is added above them, the
recommended plan's `Choose` button turns from charcoal to orange, and the rule
under every card is drawn a few shades darker. The notice pushes all three
cards 44 pixels down. Compared position by position, every row under the
notice differs, because each sits against the row that used to be there.
`variance ask describe --subject pricing/plans` answers with this headline:

```text
26,230 pixels differ across 2 strong regions in Notice, ChooseButton, and 3 faint regions, 1 changed in shape and 4 only in colour; 44 pixel rows inserted in 1 place, moving the content under them by up to 44 rows, and the subject resized from 480×288 to 480×332
```

Every line quoted below is from the example's committed
[`report.txt`](../examples/visual-review-case/artifacts/report.txt), that
command's answer for the run, and every picture is a file the run wrote beside
it.

### A shift is told from a change

Before any pixel is compared, the two images are aligned row by row, the way a
text diff aligns lines. The 44 rows of the notice have no partner in the
baseline, so they are inserted. The cards under them are compared with the rows
they were, 44 rows higher, and match, so their move costs no region: the
headline counts it as one insertion that moved the content under it. What still
differs is what the edits drew.

The run's `change.png` draws the alignment. Each row sits level with the row it
became, striped filler stands opposite the rows only the after side has, and a
blue arrow in the gutter runs beside the rows that only moved. What changed is
washed red on the before and green on the after.

The report then says which components changed by their own inputs and which
only moved. A component is a **cause** when its structure, text, accessible
name or declared styles changed, and **collateral** when only its geometry did,
decided from the page, never from the pixels:

```text
components:
  cause      ChooseButton — geometry, token
      background-color (not declared) → rgb(255 74 25 / 1)
  cause      Notice — added
  cause      PlanCard — geometry, token
      border-bottom-color rgb(226 226 226 / 1) → rgb(216 216 216 / 1)
  collateral PlanName — geometry
  cause      Plans — geometry; box 0 × +44 px
  collateral Price — geometry
```

The plan names and prices are collateral: their text and styles are the same,
and they sit lower. Collateral is where to look last, not proof that a cause
moved it, since a size declared on the component itself is geometry too.

### Different changes are reported differently

Each region is graded by how far its pixels moved. The notice and the button
are **strong**: the headline names their components. The three darker rules
are **faint**, a colour moved a few shades: the headline counts them after the
strong ones. The run's `diff.png` draws them apart: the button's changed pixels
red, the three rules pale red, and the inserted notice tinted so its text stays
legible. The HTML report draws a faint region's box dashed. [From a pixel to a line](attribution.md#how-strongly-it-changed)
owns the threshold.

Each region also says whether its drawing changed or only its colour. The
notice is new drawing, `1 changed in shape`; the button and the three rules kept
their edges and moved colour, `4 only in colour`.

Each component's line names the **bands** whose fingerprint changed:

- `a11y` — a role, accessible name, description or state changed: what a
  screen reader announces.
- `geometry` — boxes appeared, vanished, moved or resized, or the structure
  changed: tags, attributes, the boundaries between children. The names and
  prices changed in this band alone.
- `token` — declared style values changed, custom properties included, as the
  button's background and the cards' rule did.
- `content` — the component's text changed.

A fifth band, `texture`, is raster residue with no document counterpart, so no
component changes in it: it is counted on the region and the observation, as
[Sensitivity](sensitivity.md) says. Under a component, a declared style value
that changed is printed as `property from → to`. Layout values such as `width`
belong to `geometry` and get no such line, and the values are compared across
every instance of the component, so a change to one instance whose siblings
keep the old value can print none. So a new notice, a recolour and a darker
rule are three kinds, not three pixel counts, and a
[sensitivity](sensitivity.md) can let a route test pass on `token` while it
still fails on `geometry`.

### Each region is connected to its component and the page

Below the components, the report lists the regions whose pixels differ. Each
names the component that rendered it, its landmark path in the page — the
route a screen reader takes to it — and the line the component is declared at:

```text
  cause      3670px at 360,156 104×40 — ChooseButton
      in main → region "Plans" → list item 2 of 3 → button "Choose"
      examples/visual-review-case/src/plans.js:64
```

You open `plans.js` at line 64, not the image. The landmark path tells this
button from the two that did not change without a selector.
[From a pixel to a line](attribution.md) owns how each hop is made.

The pull request hears the same answer first. `variance comment` writes a
comment that leads with the cause and its line, and shows the change image
under it:

```text
Cause: **`Notice`** at `examples/visual-review-case/src/plans.js:78`
```

The example's [`comment.md`](../examples/visual-review-case/artifacts/comment.md)
is that comment for the run, and the
[`variance comment`](../packages/cli/README.md#run-it-in-ci) reference owns
its options.

## 1. Connect the harness that already reaches the state

Whichever tool already puts the app in the state you want to review — a
Playwright spec, a built Storybook, a served route, a jsdom unit test, Vitest
browser mode or Rstest — has a guide that ends the same way: that state gets a
baseline you approved, and a later run that moves pixels reports what drew
them. Adopt one harness at a time, and keep the `toHaveScreenshot` assertions
that already work.

[Choose your integration](start.md)

## 2. Keep the comparisons steady

A change your code did not make costs the same review as one it did. The run
holds the page still before it reads it, and when a subject still moves it
varies one condition at a time to say whether time, the environment, the
component or leaked state moved it — evidence, never a retry.

[Holding a page still](stabilization.md), then
[Trace instability to its owner](flakiness.md).

## 3. Read a change down to the line that drew it

A pixel count cannot be assigned to anybody. Attribution turns it into the
report above: a region, the component that rendered it, its place in the page,
and the source line it was written at, so a reviewer opens the file instead of
the image.

[From a pixel to a line](attribution.md)

## 4. Explain what the line does not

The run keeps each state's text, accessibility tree, layout, styles and pixels
apart, and each is one reading of it. Sometimes the component is known and the
reason is not: an input changed, the layout moved while the pixels did not, or
the region was never the subject. One table says which reading answers each.

[Explain variance](explain-variance.md)

## 5. Decide what the build gates on

With changes explained and noise owned, the build can block on what changed
and hand the rest to whoever owns it.

[Gate a build on what changed](gates.md) and
[Add Variance Authority to what you already use](replacing.md).
