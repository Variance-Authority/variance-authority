---
id: TASK-24
title: A run writes one record
status: To Do
assignee: []
created_date: '2026-10-02 06:00'
labels: []
dependencies: []
references:
  - docs/specs/0054-eyes-attention-is-read-as-test-steps.md
  - docs/specs/0090-coverage-is-layered.md
documentation:
  - docs/specs/0094-a-run-writes-one-record.md
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Everything a test run records about its cases (coverage, case rows, case preconditions, Eyes journals) lands in one record, `coverage.bin`, under one lock, and is layered, seeded, sharded, shared and carried by the same code. Today the case index is a second file under a second lock, and Eyes journals sit outside the cache, unshared and joined by ids that never equal the case ids.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each of the four subtasks has landed as its own green pull request, in order
- [ ] #2 No reader or writer names `.cases.bin` or an Eyes archive path
<!-- AC:END -->
