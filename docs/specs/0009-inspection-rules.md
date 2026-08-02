# Spec 0009 — Inspection rules, and where they stop

**Status:** specified, not built
**Depends on:** [0003](0003-cli.md)

## Purpose

`judge/inspect.ts` reports five kinds of defect from one snapshot, with no
baseline. It answers a question no comparison can — a defect present on the first
run is invisible to a comparison forever — and it is deliberately narrow. This
spec decides what happens next, because the two obvious directions lead to
different products and picking neither is how a rule list rots.

## The decision

**The rule list stays at what a stored snapshot can decide, and does not grow
toward axe.**

Axe has roughly ninety rules and needs a live DOM: computed visibility, colour
contrast against actual painted backgrounds, focus order, ARIA relationships
resolved by an engine. Chromatic ships it with a dashboard and a triage flow.
A team whose requirement is accessibility checking should buy that, and
`docs/comparison.md` says so.

What this has instead is two properties axe does not:

1. **Every finding names a component and a file**, through the same provenance
   chain a delta uses.
2. **It decides offline, from a stored artifact, months later.** A snapshot is a
   document; a rule that needs a live page cannot be re-asked about last
   quarter's build.

A rule that needs a live DOM breaks the second property, which is the only one
that is ours. So the boundary is: **a rule belongs here if it can be decided from
a `SemanticSnapshot` alone.**

## Behaviour

**No severity field.** A rule that needs a severity to be tolerable is a rule
whose condition is too broad; the fix is a better condition or no rule. Adding
one would make the list grow by making bad rules survivable.

**Findings never change a verdict.** A tool that blocks a merge on day one over
findings nobody asked for gets switched off in week one. `blocking: ['a11y']` is
the opt-in, and it covers inspection and comparison under one policy because both
produce the same band.

**Empty is not absent.** `findings: []` means the render was inspected and was
clean; no `findings` key means nothing inspected it. Already enforced in
`ObservationRecord` and in `variance_findings`, and it is the property that keeps
a run over a collector with no snapshot from reading as a clean bill of health.

## Rules that qualify and are not written

- **`label-mismatch`** — a control whose visible text is not a prefix of its
  accessible name, which breaks voice control ("click Save" does nothing when
  the label says "Save changes to draft"). Decidable: both strings are in the
  snapshot.
- **`duplicate-landmark`** — two landmarks of one role with no distinguishing
  name in one subject.
- **`table-without-headers`** — a `table` role with no `columnheader`.
- **`positive-tabindex`** — `tabindex` greater than zero. Already allowlisted as
  an attribute.

## Rules that do not qualify, and why

- **Colour contrast.** The snapshot has resolved `color` and `background-color`
  per node, so a naive check is tempting and would be wrong: the actual
  background is whatever is painted behind, which is a stacking question a layout
  engine answers and a document does not. A rule that is right most of the time
  about accessibility is worse than no rule.
- **Focus order.** Needs the sequential focus navigation order, which is a
  property of the live document.
- **Anything about motion.** Nothing here observes animation; `flakiness.md`
  already records that a transform caught in flight reaches the representation
  and is absorbed by nothing.

## Acceptance

1. The four qualifying rules above are implemented and each has a case where it
   must *not* fire, written before the rule.
2. Contrast is not implemented, and `inspect.ts` states why in the file rather
   than leaving it as an obvious omission somebody adds badly later.
3. A run over `cases/storybook-case` reports its findings and its verdict
   independently — a subject can be `unchanged` and carry findings.
