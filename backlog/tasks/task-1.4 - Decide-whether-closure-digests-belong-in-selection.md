---
id: TASK-1.4
title: Decide whether closure digests belong in selection
status: To Do
assignee: []
created_date: '2026-08-16'
labels: []
dependencies: []
parent_task_id: TASK-1
ordinal: 10400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`core/relate` implements and tests `closureOf` and `driftedBetween`, while
`run-select` does not read a closure sidecar or consult either digest. Spec
0026 names storage and comparison as open. The graph work is therefore a
measured capability without a consumer, and its selection value is not yet a
product fact.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Investigate the selection contract, closure storage options, volatile-input semantics, and the existing run/report boundaries
- [ ] #2 Confirm the value and failure behavior with a bounded changed-import selection run, including a stale or volatile closure case
- [ ] #3 Fix the end-to-end storage/selection/report path, or close/specify the capability as intentionally unused without leaving an implied guarantee
<!-- AC:END -->
