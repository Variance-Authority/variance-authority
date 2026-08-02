# todomvc

A small design system, the pixel arm, and the end-to-end.

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

The third column is the point, and so is the word `collateral`. Ranked by area
that report is **wrong**: `Stack` was never edited, only reflowed, and it
outranks the actual edit by 6×. Area measures displacement, so the ordering has
to come from the tier that has provenance.

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
