# ADR-0047 — A runtime scenario is a witnessed path through named states

**Status:** accepted
**Date:** 2026-08-25
**Relates to:** ADR-0002 (absent is not empty), ADR-0045 (a subject may be a
variation of another), ADR-0046 (a name may be told what its words mean)

## Context

A linked subject pair explains one deliberate difference, and a `Trail` explains
several readings of one subject. Neither records the ordered relation between an
initial world, the meaningful acts performed there, and the states observed
after them. An event log supplies order without semantic state; a list of
snapshots supplies states without transitions.

The missing shape is AAA. Arrange is already the state-machine precondition, Act
is already a transition, and the third A is where the resulting variance is
assessed. Treating AAA as anything less loses the structure the recording needs.

## Decision

**A runtime scenario execution is one witnessed path through a state machine.**

Arrange records a planned subject and its observed semantic state. The subject
is produced by its existing host and resolved through the existing parent/name
machinery; the scenario carries that link and never parses the name again.

Each Act has an author-supplied stable key. The observed outcome becomes the
destination state, identified by `SemanticSnapshot.renderHash`. Occurrence aligns
repeated visits while comparing two paths; it is not part of the transition
label. DOM events, selectors, targets, and payloads are not identity and are not
needed by the record.

Assert is a variance assessment with three separately typed readings: the two
Arrange states, each before/after transition effect, and the divergence between
corresponding effects across executions. The effect identity is the existing
variation digest over semantic deltas, so it survives equal movement on both
sides and moves when the transition does something else.

Executions align only their common ordered prefix by `(key, occurrence)`. A
different Act leaves every remaining Act unmatched rather than shifting
ordinals. An unobserved outcome terminates the reachable prefix and makes the
first divergence unresolved.

Folding executions groups frames by render hash and retains every witnessed
`state --Act--> state` edge. Shared states converge. Several destinations for
one state and Act are observed branching. Missing evidence is an unknown edge,
and an edge no execution saw is absent rather than impossible.

## Consequences

AAA is directly inspectable as a partial machine without claiming replay or
complete reachability. A transition is evidence that the destination followed
the Act under the observed run; it does not establish that the Act was the only
cause.

The third A remains inquiry. A host may assert an expectation against the
assessment, but the scenario package itself cannot gate, approve, promote a
baseline, write history, or change an exit code.

Profile asymmetry remains visible. Comparisons report every unobservable band
and which side was blind, so jsdom beside Chromium cannot silently settle
geometry.
