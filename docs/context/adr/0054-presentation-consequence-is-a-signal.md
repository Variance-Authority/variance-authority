# ADR-0054 — Presentation consequence is a signal, not render impact

**Status:** accepted
**Date:** 2026-08-26
**Extends:** ADR-0015 (findings do not change verdicts by default), ADR-0050
(presentation evidence is not a regression lifecycle), ADR-0053 (product meaning
names hierarchy roles)

## Context

The regression report already carries independent document, pixel and browser
accessibility signals. Its impact axis answers a different question: whether a
changed property can reflow layout, repaint a box, or stay in compositing.

A hierarchy collision is neither axis. `layout` says a spacing edit can move
other boxes; it does not say that the edit collapsed two product relationships.
A current-render finding says the collision exists; it does not say whether the
edit introduced it, resolved it, or changed a collision that persisted. Folding
the three together would let presentation evidence silently acquire regression
policy, or let a technically valid token erase the consequence it produced.

## Decision

**A general observation may carry a presentation signal whose effects describe
rendered consequences independently of render impact and verdict.**

`ObservationRecord.signals.presentation` is absent when no producer measured
that boundary. An incomparable signal names the missing side and carries no
effects. A comparable signal retains the before and after presentation digests,
content identity, information-count deltas, and a possibly empty effects list.
Empty means measured with no changed consequence.

Each effect is `introduced`, `resolved`, or `persisted`. It retains the rule,
owner, nodes, optional product contract, and the finding id and measurements on
the side each transition requires. Persisted is emitted only when the same
relationship condition survives with changed measurements; an identical
pre-existing condition is not attributed to the edit.

`presentationSignal` derives the record from two presentation reports and any
product-owned hierarchy readings evaluated against them. A hierarchy reading
from a different report and duplicate relationship identities are refused. The
CLI collector contract accepts the completed signal and the record mapping keeps
it on compared, new, incomparable and digest-settled paths.

The JSON report owns the durable value. Text, HTML, MCP and Tribunal render or
store that value; none re-runs the analyzer. File reads reject a transition that
does not carry its required side of evidence.

## Consequences

A report can state that an edit introduced the Underwriter hierarchy collision
while separately stating that its CSS impact is layout and its visual-regression
verdict is changed. A project may later apply policy to the presentation signal,
but storing the signal does not do so.

The producer must have comparable presentation readings. Existing collectors
that do not supply them continue to omit the member, which is unobserved rather
than clean. The report retains compact consequences and information counts, not
the complete presentation graph or diagnostic paint.
