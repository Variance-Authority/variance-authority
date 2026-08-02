# Spec 0009 — Inspection rules, and where they stop

**Status:** built
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

## The rules

Nine, each with a case where it must **not** fire, and in several the
non-firing case is the one that decides whether the rule is usable at all.

| rule | fires on | must not fire on |
|---|---|---|
| `control-without-name` | an interactive role with no accessible name | a non-interactive element, however unnamed |
| `image-without-alt` | an image role with neither a name nor `alt=""` | `alt=""`, which is the author answering the question |
| `heading-level-skipped` | a forward jump of more than one level | a subject starting at `h3`; a level going back up |
| `nested-interactive` | a control inside a control | — |
| `dangling-reference` | an IDREF that resolves to nothing in this subject | a reference that resolves |
| `label-mismatch` | a control whose name does not contain its visible text (WCAG 2.5.3) | a name that *extends* the visible text; an icon button, whose glyph is `aria-hidden` and is not a label |
| `duplicate-landmark` | two landmarks of one role that nothing tells apart | two navigations with different names |
| `table-without-headers` | a `table` role with no header cell anywhere in it | a table with one `columnheader` |
| `positive-tabindex` | `tabindex` above zero | `0` and `-1`, the two ordinary values |

`label-mismatch` is the one whose *negative* case carries the design. Every
design system has icon buttons; a rule that reported all of them would be
switched off before it found anything, and it takes the eight that work with it.
Visible text excludes `aria-hidden` subtrees and must carry a letter, so a glyph
is not a label.

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

1. **Met.** Nine rules, each with a non-firing case (`inspect.test.ts`, 26 tests).
2. **Met.** Contrast is not implemented and `inspect.ts` states why in the file,
   rather than leaving it as an obvious omission somebody adds badly later.
3. **Met.** `cases/storybook-case/src/cli.chromium.test.js` asserts that every
   observation carries a findings list, so a clean run means *inspected and
   clean* rather than *nobody looked* — and a subject can be `unchanged` and
   carry findings.

Still open: no rule here has run against an application this project did not
write. `cases/storybook-case` reports **0 findings across 8 subjects**, which is
a real answer about that design system and not a measurement of the rules.
