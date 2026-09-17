# ADR-0025 — An ignore names a place or a shape, never a coordinate

**Status:** accepted
**Date:** 2026-08-05
**Discharges:** spec 0024 (an ignore is a declaration, not a blind spot)

## Context

The README refuses tolerances, and the refusal is right: a tolerance is an
anonymous number, chosen by whoever wrote the default, that hides anything small
enough to fit under it. Nothing records what a given run's tolerance absorbed, so
the question "what did that number cost me" has no answer at all.

Refusing tolerances is not the same as refusing to exclude anything, and until
2026-08-05 this project did both. A header carrying a clock made every subject
containing it permanently red, and the two available responses were to delete the
subject or to stop running. `docs/comparison.md` conceded the gap to all three
competitors, and conceded the strongest form of it to Argos, which scopes an
ignore to a `(test, diff-shape)` pair rather than to a rectangle and publishes
[the implementation](https://github.com/argos-ci/mask-fingerprint).

The design question was never *whether*. It was what an ignore is allowed to
name, because that decides what it silences when the page moves.

## Decision

**An ignore names a subtree or a difference shape. There is no coordinate form.**

*A place* is a CSS selector, resolved against the live document by the collector —
the only step that needs one — and recorded as an `IgnoreSite`: a node path and
the box it occupied. One declaration serves both tiers. The semantic comparison
drops every delta under the path; the raster comparison subtracts the box from the
change mask before counting or isolating anything. Two declarations were rejected
because two would let the tiers disagree about what the subject is, and a region
excluded semantically but still compared on pixels arrives as `unexplained` — the
highest severity in the system — about something the operator already excluded.

*A shape* is a fingerprint: a digest of a difference with its position and its
values removed. Semantically, the multiset of `(kind, band, property)` across a
root's deltas plus the component responsible. On raster, the change mask cropped
to its own bounding box and resampled onto a fixed grid, with the aspect ratio
bucketed coarsely alongside. The same artifact anywhere in any subject digests the
same, and every region a run reports carries its own fingerprint, so writing a
shape-scoped rule is copying a digest out of a report rather than deriving one.

**A rectangle is refused.** It is the form every competing product offers and the
one that stops covering the thing it was drawn around the first time the layout
moves. The case that would justify one — an imported foreign PNG with no document
behind it — is [not something this project accepts](../../../README.md#where-it-fits),
and a field with no correct use is a field that gets used.

**A band on its own is refused.** `bands` narrows a rule that already names a
place or a shape; a rule carrying only a band absorbs everything of that band in
every subject it lists, which is a tolerance wearing an ignore's clothes.
`validateIgnoreRule` enforces it, in `core`, so a library consumer composing the
pipeline by hand cannot route around the config parser.

**Every rule carries a reason, and the reason is required.** Six months on, the
only question anyone asks about an ignore is whether it is still true, and a rule
that cannot answer gets kept out of superstition.

## Consequences

**The shape form is the one that scales, and it is genuinely different.** A
fingerprint ignore silences a known flake without blinding the region it appears
in: a different regression in the same place has a different shape and is still
reported. The semantic fingerprint carries the component responsible, so silencing
a flake in `Avatar` does not silence the identical-looking regression in `Badge` —
a distinction neither a rectangle nor a pixel-shape digest can make. The pixel
fingerprint is the weaker of the two and is named as such where it is defined.

**Ignores are outside the environment key.** Editing one changes what a run
*says*, never what it *renders*, so a baseline survives an ignore edit. The
alternative would re-baseline the repository the first time somebody masked a
clock, which is how a safety feature becomes the thing people switch off. This
puts `ignoreSites` beside `styleProvenance` and `diagnostics` on the snapshot —
carried, never hashed — and it is why the marker attribute `data-variance-ignore`
is deliberately absent from the attribute allowlist.

**The collector marks; it never deletes.** An element removed from the capture
would be absent from every count downstream, and "absorbed by the `carousel` rule"
and "was never there" are the two states this whole mechanism exists to keep
apart. So the collector records `RawNode.ignoredBy` and does nothing else with it.

**Sites are resolved from the finished tree.** Wrapper collapse re-paths whole
subtrees, so a path recorded during normalization names a node that may not be
there afterwards — and an ignore that quietly slid one level up absorbs a sibling
nobody excluded. `sitesIn` runs on the tree that survived.

**What it costs.** A selector is evaluated per subject, and a selector that
matches nothing there is ordinary — a rule scoped to a page header says nothing
about a button story. So the collector reports `ignore-unmatched` per subject and
only the run-level ledger can tell that apart from a rule that matches nothing
anywhere. That is more machinery than a rectangle would have needed, and it is
what buys the ledger in [ADR-0026](0026-ignored-is-not-unchanged.md).

**What is not decided here.** Whether a fingerprint should also be able to carry
an approval — "this shape is accepted everywhere it appears" — is the same digest
pointed at a different question, and it belongs with acceptance rather than with
ignores.
