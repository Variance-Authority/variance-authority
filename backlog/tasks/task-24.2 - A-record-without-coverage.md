---
id: TASK-24.2
title: A record without coverage
status: To Do
assignee: []
created_date: '2026-10-02 06:01'
updated_date: '2026-10-02 06:01'
labels: []
dependencies:
  - TASK-24.1
parent_task_id: TASK-24
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A run that keeps cases but instruments no module still writes the record, with its module sections absent. Spec 0094, item 2.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An uninstrumented run that keeps cases writes `coverage.bin` with case sections and no module sections
- [ ] #2 Selection reads such a record as unmeasured and narrows nothing, pinned by a test
<!-- AC:END -->
