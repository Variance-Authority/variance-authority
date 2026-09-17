# Understand an interface

**[Variance Authority](README.md)** is a visual regression system you run yourself: it
renders a UI state, compares it against the baseline you approved, and reports
what changed in the vocabulary of your source — the component that drew the
pixels and the `file:line` it was written at.

This page is the hub for the evidence it reads *beside* the image: the measured
relationships of the rendered layout, the elements your test actually addressed,
and the React component that owns each of them. All three read one live page
inside a Playwright or Vitest run you already have, and none of them needs a
previous image, an approved baseline, or a stored comparison. New here? Start
with [your first run](start.md).

A **subject** is one named UI state you asked for and can ask for again,
identified by a stable id you choose such as `story:checkout--empty`. Each
reading below takes one subject and hands back data you assert on.

## Pick the reading that answers your question

| Your question | What it hands back | Where to go |
| --- | --- | --- |
| Do the rendered gaps, alignments and weights still separate the things my structure says are separate? | A graph of the rendered boxes, the relationships between them — gap, alignment, shared baseline, relative visual weight, repetition — and the places where a distinction the structure implies is not present in the pixels | [Inspect presentation relationships](presentation.md) |
| Which rendered elements did this test actually operate, and who rendered them? | Every element the test queried, clicked, read or asserted on, in order, each carrying the React component that rendered it | [Follow the test's eyes](eyes.md) |
| Which component owns this element, and does the capture follow the component tree or the DOM? | Component [provenance](attribution.md) and ownership, plus the content a component renders elsewhere in the document through `createPortal` | [Keep framework evidence](framework.md) |

## One finding, in full

Point presentation evidence at a list of six repeated records where the gap
between records is 4px and the gap inside each record is also 4px. It returns a
finding named `SPACING_RELATION_COLLISION`, the element that arranges those
records, and the numbers behind the call: `betweenGapMedianPx: 4`,
`withinGapMedianPx: 4`, `ratio: 1`. Nothing in the stylesheet is wrong and
nothing in a screenshot diff is different — this is how the page has always
shipped — but the boundary between two records carries no more separation than
the boundary inside one, so the six read as a single block of text. `ratio` is
a number your test can assert on.

The other two readings answer in the same shape. [Eyes](eyes.md) tells you that your
checkout test rendered a nav bar, a clock and an order form but only ever
addressed the form, so the rest is unprotected. Framework evidence tells you
that a subject whose boundary does not follow portals is byte-identical whether
the modal inside it is open or closed.

## What these readings will not do for you

They return measurements, not verdicts. Nothing here decides that a design is
good, picks a spacing value, or fails your build on its own; you assert on the
numbers, and the decision stays with whoever knows what the product is for.

A reading the page cannot supply comes back absent rather than as a guess: a
page with no React tree carries no wiring digest instead of a digest of
emptiness. If the distinction you need is missing from all three readings, the
subject you captured does not contain it yet — capture the state that does, and
read that one.
