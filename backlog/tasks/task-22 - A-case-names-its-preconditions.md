---
id: TASK-22
title: A case names its preconditions
status: To Do
assignee: []
created_date: '2026-10-02 05:26'
labels: []
dependencies: []
references:
  - docs/context/adr/0046-a-name-may-be-told-what-its-words-mean.md
documentation:
  - docs/specs/0093-a-case-names-its-preconditions.md
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A test declares the state it arranged (mocked network, a flag, the dragon colour) at runtime with `variancePrecondition` from `@variance-authority/sense/precondition`, and the recording carries it per case, so cases can be filtered by it and paired with their twin one axis away. Spec: docs/specs/0093-a-case-names-its-preconditions.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Vitest, Jest, Rstest or Playwright case that calls `variancePrecondition` carries those preconditions, with call sites, on its row in `cases.bin`
- [ ] #2 Hook calls land on the cases the hook ran for; a describe-scoped beforeEach does not reach a sibling describe
- [ ] #3 A narrower scope overrides a wider one; two values in one scope are reported as a contradiction, not resolved
- [ ] #4 `variance covering … --cases --where network=mocked` returns exactly the cases that declared it; an older record answers unmeasured
- [ ] #5 Named preconditions never select or exclude a test
- [ ] #6 With no recording the call is a no-op and the entry imports nothing
- [ ] #7 When `names.axes` declares a name, `ask --test` names the one-step twin along the last axis
<!-- AC:END -->
