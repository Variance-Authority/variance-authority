---
id: TASK-24.1
title: Cases in the record
status: To Do
assignee: []
created_date: '2026-10-02 06:01'
labels: []
dependencies: []
parent_task_id: TASK-24
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The case index becomes sections of `coverage.bin`, with case crossings pointing into the record's own blocks, landed under the snapshot's one lock. Spec 0094, item 1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Case rows (id, file, name, stopped, duration, attempt) and crossings are sections of `coverage.bin`, with no second module table
- [ ] #2 One landing under one lock; both FIXMEs on the case lock in journal.ts and case-fold.ts are gone
- [ ] #3 Seeding, repinning, the mainline layer, shard folding, `variance share` and `carry` move one file
- [ ] #4 A fold that meets an unknown section refuses rather than dropping it
- [ ] #5 No code reads or writes `.cases.bin`; its size, measured on this repository and on the seven-MUI corpus, is stated in the PR
<!-- AC:END -->
