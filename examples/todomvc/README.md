# todomvc

**Showcase:** advanced semantic attribution, flakiness diagnosis, composition,
and render offload; this is not a normal visual-regression starter.

A small design system, and three suites over it: attribution, a pixel-diff
opponent to measure it against, and the render offload.

**What it proves:** a real application can turn a pixel count into named causes
and collateral, compare the mechanisms that absorb instability, relate subjects
through their shared component graph, and render an acquired document elsewhere.

**Boundary:** the fixtures are authored here. The offload proof establishes
byte identity and subject geometry over the wire, not that the reconstructed
image is faithful to the original page.

Where the claims stop being about snapshots and start being about **pixels
attached to code lines**.

## Pixels to code lines

```bash
yarn vitest run examples/todomvc/src/observe.chromium.test.ts
```

```
--- broken-toggle on page/todos--populated
what a pixel differ reports:  1530 pixels changed
what this reports:            5 region(s)
  cause       933px in 2 region(s) — Text     src/ds/components.tsx:42
  cause        86px in 2 region(s) — Toggle   src/ds/components.tsx:107
                in checkbox "Mark "Prove the tiering" as done"
  collateral  511px in 1 region(s) — Stack    src/ds/components.tsx:27
```

The third column is the point, and so is the word `collateral`. The edit swapped
`Toggle`'s native checkbox for a styled `<div>`, which is 4px shorter; `Text` sits
inside the same rows and restyles with it, and `Stack` merely reflows around both.
Ranked by area that report is **wrong**: `Stack` at 511px was never edited and
outranks `Toggle`, which *is* the edit, by 6×. Area measures displacement, and
displacement is largest where the change is not. So the ordering has to come from
the tier that has provenance — which is what puts both `Text` and `Toggle` above
`Stack` in the report as printed.

## The pixel arm

```bash
yarn vitest run examples/todomvc/src/pixel.chromium.test.ts
```

A deliberately fair opponent: the same subjects through an ordinary
screenshot-and-diff pipeline, so every claim about cost and about flakiness has a
number beside it that was measured rather than assumed.

It prints the instability table — two runs of the same commit, nothing changed —
and it includes the row where **we lose**:

```
source               pixel arm          ours     absorbed by
------------------------------------------------------------
text-smoothing       moves (177px)      holds    construction
device-pixel-ratio   moves (3015px)     holds    environment-key
scrollbar            holds              holds    headless-artifact
clock                moves (73px)       moves    policy
block-whitespace     holds              moves    nothing
```

`absorbed by` names *how* each source stops costing a review, and no two rows use
the same mechanism:

- **construction** — the representation never carried the quantity. Glyph
  rasterization is not a property of the box tree, so there is nothing to
  threshold; it is absent rather than tolerated.
- **environment-key** — the difference is real, and `deviceScaleFactor` is part
  of the identity, so the two runs address different baselines and never meet. A
  pixel differ has the same option and has to be configured to take it.
- **headless-artifact** — **not absorbed by anyone.** Headless Chromium uses
  overlay scrollbars, so the reflow never happens here and *both* arms are blind
  to something every headed user sees. Kept in the table because "it only flakes
  in CI" is, for this cause, exactly inverted.
- **policy** — both arms move and neither is wrong; what differs is the cost of
  silencing it. A pixel differ masks a coordinate region, which silences whatever
  else lands there and breaks when the layout moves; `digestText` masks the text
  node, which follows the content.
- **nothing** — it reaches the representation and we report it anyway. There is
  one such row, and it is the next paragraph.

`block-whitespace` moves for us and holds for the pixel arm. It is in the table
because a comparison that only listed the rows we win is not a comparison.

## The offload

```bash
yarn vitest run examples/todomvc/src/offload.chromium.test.tsx
```

**jsdom describes, Chromium paints.** A document acquired in a unit-test process
renders byte-identically in-process and over an HTTP hop — which is what makes
"acquire here, render on a pinned machine" a wiring decision rather than a
rewrite.

## Honest limit

**The acquired document is not proven faithful.** It paints something with the
subject's geometry that responds to its styling, over a socket, byte-identically.
That is enough to offload. It is not the same claim as *"the image matches the
page it was acquired from"*, and nothing here demonstrates the stronger one.
