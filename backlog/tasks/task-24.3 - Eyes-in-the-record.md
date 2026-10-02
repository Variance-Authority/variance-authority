---
id: TASK-24.3
title: Eyes in the record
status: To Do
assignee: []
created_date: '2026-10-02 06:01'
updated_date: '2026-10-02 06:01'
labels: []
dependencies:
  - TASK-24.1
parent_task_id: TASK-24
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Eyes journals become sections of the record, keyed by case and attempt, and join cases exactly. Spec 0094, item 4, and spec 0054 sections 2 and 4.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Eyes journals are written into the record per case and attempt, only when the run opted in
- [ ] #2 The Playwright fixture and `watchTest` take their case from the case scope, never `testInfo.testId`
- [ ] #3 Paths in the journals are repository-relative
- [ ] #4 `distill` reads Eyes from the record; `--eyes` and the archive path are removed
- [ ] #5 A Playwright retry keeps both attempts and joins its case exactly, pinned by a fixture
<!-- AC:END -->
