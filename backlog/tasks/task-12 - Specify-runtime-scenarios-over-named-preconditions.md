---
id: TASK-12
title: Specify runtime scenarios over named preconditions
status: Done
assignee:
  - '@codex'
created_date: '2026-08-24 23:12'
updated_date: '2026-08-25 00:08'
labels: []
dependencies: []
references:
  - docs/context/adr/0045-a-subject-may-be-a-variation-of-another-subject.md
  - docs/context/adr/0046-a-name-may-be-told-what-its-words-mean.md
  - docs/specs/0033-two-sides-a-person-chose.md
modified_files:
  - docs/specs/0034-runtime-scenarios.md
  - docs/specs/README.md
  - docs/context/checkpoint.md
type: docs
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Define the unbuilt contract for recording a SUT from a named Arrange precondition through runtime Acts, with variance as Assert. The spec must connect the existing great-green-dragon subject-name grammar to preconditions without teaching Variance Authority about mocks or fixture recipes, and must bound storage, retention, comparison, and replay.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new docs/specs vacancy defines precondition, runtime event, assertion variance, and their identities without contradicting ADR-0045 or ADR-0046.
- [x] #2 The spec distinguishes recording evidence from derived variance and states how initial-condition and post-event divergence are aligned and reported.
- [x] #3 The spec defines content-addressed storage and retention boundaries without putting pixels or full traces into append-only history.
- [x] #4 Acceptance scenarios cover named initial states, aligned actions, action-sequence disagreement, unobserved outcomes, and a host that supplies setup without mock integration.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Correct the model so AAA is explicitly a witnessed path through a state machine: Arrange is a state, Act is a transition, and Assert is the observed transition variance. 2. Preserve the boundary that the name grammar names states but does not invent transitions; multiple executions compose a partial observed machine. 3. Narrow the non-goal to completeness and exclusive causality, add an executable graph-composition acceptance case, and rerun documentation verification.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Two independent reviews challenged architecture/storage and product value. The final model stores named acts and semantic observations, derives Arrange variation, transition effect, and execution divergence separately, keeps the default ephemeral, and uses the opt-in text capture archive anticipated by spec 0033. Validation: yarn check passed 6,215 tests with 1 todo through a temporary index that exposed the untracked new spec without staging it; git diff --check passed.

User correction: AAA is itself a state machine. The previous non-goal conflated a witnessed transition system with automatic inference of a complete machine.

Corrected after review: AAA is explicitly the state machine. Added separate snapshot-object and render-state digests, path-to-partial-graph folding, convergence and branching semantics, and an acceptance case for multiple outcomes from one state and Act. Occurrence remains path-alignment evidence rather than transition identity. Revalidation: yarn check passed 6,215 tests with 1 todo; git diff --check passed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Drafted and corrected spec 0034 for runtime scenarios over named preconditions. Arrange is a machine state, Act labels a transition, and Assert records the observed destination and variance; executions are witnessed paths that compose a partial graph without claiming completeness or exclusive causality. The spec also defines alignment, addressable semantic storage, privacy, retention, and inquiry boundaries. Verified with 6,215 repository documentation checks and a final documentation review.
<!-- SECTION:FINAL_SUMMARY:END -->
