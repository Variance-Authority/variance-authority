# ADR-0015 — A rule belongs here if a stored snapshot can decide it

**Status:** accepted
**Date:** 2026-08-03
**Extends:** ADR-0007 (the subject boundary is the component tree), ADR-0012 (observability and the damage boundary)
**Discharges:** spec 0009

## Context

Comparison cannot see a defect that was present on the first run. A control that
never had an accessible name compares equal to itself forever, so approving the
first baseline approves the defect, in every product in this category. Inspection
— rules read off a single `SemanticSnapshot`, with no baseline consulted — is the
answer to that, and it worked immediately: nine rules, one of which found
`<button><span aria-hidden="true">↻</span></button>` named "↻" in this
repository's own fixture.

Working immediately is exactly when a rule list starts to rot. The pull is
towards axe: roughly ninety rules, an established vocabulary, a name a buyer
recognises, and every individual addition arguable. Nothing in "we check
accessibility" says where to stop, and a list with no boundary acquires rules
that are right most of the time — which for accessibility is worse than having no
rule, because a reviewer who has been told the page is clean stops looking.

The two obvious directions lead to different products. Growing towards axe means
competing with a tool that has a dashboard, a triage flow and a decade of rules.
Staying narrow means declining requests with no principle to decline them by.
Picking neither is how the list rots, so the boundary had to be a decision rather
than a habit.

## Decision

**A rule belongs to inspection if it can be decided from a `SemanticSnapshot`
alone. The list does not grow towards axe.**

The snapshot is a *document*: tags, roles, accessible names, state, normalized
attributes, text, resolved declarations, and rects. What it is not is a live
page. Axe's rules need one — computed visibility, contrast against whatever is
actually painted behind, sequential focus order, ARIA relationships resolved by
an engine — and a rule needing a live page cannot be re-asked about last
quarter's build.

That is the property worth protecting, and it is the one that is ours:

1. **Every finding names a component and a file**, through the same provenance
   chain a delta uses. Axe names a selector.
2. **It decides offline, from a stored artifact, months later.** A snapshot is a
   document; a live-DOM rule is a measurement that expires the moment the page
   closes.

A team whose requirement is accessibility checking should buy the tool built for
it, and [`docs/comparison.md`](../../comparison.md) says so in those words.

Two rules follow, and both exist to stop the list growing by making bad rules
survivable:

**No severity field.** A rule that needs a severity to be tolerable is a rule
whose condition is too broad. The fix is a better condition or no rule. A
severity column is how a list acquires forty rules nobody acts on.

**Findings never change a verdict by default.** A tool that blocks a merge on day
one over findings nobody asked for is switched off in week one. `blocking:
['a11y']` is the opt-in, and it covers inspection and comparison under one policy
because both produce the same band.

### Where the boundary actually falls

Excluded, with the reason, so nobody adds them badly later:

- **Colour contrast.** The snapshot carries resolved `color` and
  `background-color` per node, which makes a naive check tempting and wrong: the
  actual background is whatever is painted behind, which is a stacking question a
  layout engine answers and a document does not. `inspect.ts` states this in the
  file rather than leaving an obvious omission.
- **Focus order.** Sequential focus navigation order is a property of the live
  document.
- **Anything about motion.** Nothing here observes animation, and
  [`flakiness.md`](../../flakiness.md) already records that a transform caught in
  flight reaches the representation and is absorbed by nothing.

Included, nine of them, each with a case where it must **not** fire — and in
several the non-firing case is what decides whether the rule is usable at all.
`label-mismatch` carries the design: every design system has icon buttons, a rule
that reported all of them would be switched off before it found anything, and it
would take the other eight with it. Visible text therefore excludes `aria-hidden`
subtrees and must carry a letter, so a glyph is not a label.

## Consequences

**`findings: []` and no `findings` key mean different things, and the type says
so.** Empty means the render was inspected and was clean; absent means nothing
inspected it. Enforced in `ObservationRecord` and in `variance_findings`, and it
is what keeps a run over a collector with no snapshot from reading as a clean
bill of health.

**A rule request now has an answer that is not a preference.** "Can it be decided
from a stored snapshot?" is a question about the artifact, so the answer does not
depend on who is asking or how much they want it.

**The comparison document has to be honest about what this is not.** Nine rules
against roughly ninety is a real gap for a team whose requirement is
accessibility, and the argument for this list is not "it is enough" — it is that
these nine name a component and a file and survive being asked six months later.
Both halves are stated where a reader deciding what to buy will see them.

**It has never run against an application this project did not write.**
`cases/storybook-case` reports 0 findings across 8 subjects, which is a real
answer about that design system and not a measurement of the rules. Whether the
nine hold up outside this repository is open, and no case here closes it.

**`compareLocales` contributes two more rules from a *pair* of renders**, which
one snapshot cannot answer, so `FindingRule` carries eleven where inspection
carries nine. That is not a hole in this boundary: a locale comparison is two
documents rather than a live page, so it keeps the property this ADR protects.
