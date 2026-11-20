# Review a visual change

A screenshot suite tells you that pixels differ. A change report from
[Variance Authority](README.md) tells you three more things: which components
your edit changed and which it only pushed aside, what kind of change each is,
and which component, place in the page and source line each differing region
comes from. This page shows the three on one recorded run, then orders the steps that
get the same report out of your own suite and a build that gates on it.

Every step runs on your own build machine, against baselines in your own
repository, and links the page that owns it.

## What a change report gives you

The [visual-review example](../examples/visual-review-case/README.md) renders
three pricing cards. One edit renames the Team plan to
`Team, billed yearly for every seat`, so the name wraps onto a second line, and
moves the accent every `Choose` button is painted in from charcoal to orange.
Nothing else is edited. A screenshot diff of it is five red patches across the
three cards. `variance ask describe --subject pricing/plans` answers with this
headline:

```text
12,267 pixels differ across 5 regions in ChooseButton, PlanName, Price, 2 changed in shape and 3 only in colour
```

Every line quoted below is from the example's committed
[`report.txt`](../examples/visual-review-case/artifacts/report.txt), that
command's answer for the run.

### A shift is told from a change

The report lists each component the run saw change. A component is a
**cause** when its own inputs changed — its structure, its text, its
accessible name, its declared styles — and **collateral** when only its
geometry did: where it sits and how big it is. That is decided from the
components' inputs, read from the page, never from the pixels. Collateral is
where to look last, not a verdict that a cause moved it: a size declared on the
component itself also counts as geometry.

```text
components:
  cause      ChooseButton — token
      background-color rgb(36 40 42 / 1) → rgb(255 74 25 / 1)
  cause      PlanName — a11y, geometry, content
  collateral Price — geometry
```

The price is 524 pixels of red in the diff image, the same red as the name.
The report calls it collateral: its text and its props are the same, and it is
lower because the name above it wraps. You review two causes, not five
regions.

### Different changes are reported differently

Each component's line also says what kind of change it is. Its properties are
split into **bands**, each band is reduced to a short fingerprint, and the line
names the bands whose fingerprint changed. A component changes in four:

- `a11y` — a role, accessible name, description or state changed: what a
  screen reader announces. The renamed heading is one.
- `geometry` — boxes appeared, vanished, moved or resized, or the structure
  changed: tags, attributes, the boundaries between children. The pushed price
  changed in this band alone.
- `token` — declared style values changed, custom properties included, while
  the structure stayed the same, as the buttons' background did.
- `content` — the component's text changed. The heading's did.

A fifth band, `texture`, is raster residue with no document counterpart, so no
component changes in it: it is counted on the region and the observation, as
[Sensitivity](sensitivity.md) says.

Under a component, a declared style value that changed is printed as
`property from → to`: the buttons' `background-color`, from charcoal to orange.
Layout values such as `width` belong to `geometry` and get no such line, and
the values are compared across every instance of the component, so a change to
one instance whose siblings keep the old value can print none.
So a recolour, a renamed heading and a pushed price are three kinds, not three
pixel counts, and a [sensitivity](sensitivity.md) can let a route test pass on
`token` while it still fails on `geometry`.

### Each region is connected to its component and the page

Below the components, the report lists the regions whose pixels differ. Each
names the component that rendered it, its landmark path in the page — the
route a screen reader takes to it — and the line the component is declared at:

```text
  cause      3670px at 360,160 104×40 — ChooseButton
      in main → region "Plans" → list item 2 of 3 → button "Choose"
      examples/visual-review-case/src/plans.js:56
```

You open `plans.js` at line 56, not the image. The one accent edit repainted
three identical buttons, so the report lists three such regions, all at that
line; the landmark path tells them apart — `list item 1 of 3`, `2 of 3`,
`3 of 3` — without a selector. [From a pixel to a line](attribution.md) owns
how each hop is made.

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
