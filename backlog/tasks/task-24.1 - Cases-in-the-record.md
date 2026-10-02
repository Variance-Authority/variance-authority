---
id: TASK-24.1
title: Cases in the record
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-02 06:01'
updated_date: '2026-10-02 06:53'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Case sections (cases, cases.before, cases.last) in the coverage.bin section container; FORMAT 10 for a cased record, 9 stays for an uncased one.
2. landCases computes the sections; land and the seams write coverage and cases in one write under the record lock.
3. sharedRecord strips cases.before/cases.last on seed, repin, mainline publish, share and fetch; the share entry carries coverage.bin only.
4. Readers (decodeExecutionIndex, readExecutionIndex, covering, review, distill --execution) take the record; executionFile removed.
5. Tests migrated to the record contract; docs and changeset; size measured.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Cases live in coverage.bin as sections; no code reads or writes .cases.bin. Size on this repository (three cached records): the cases add the index's own bytes plus ~60 bytes of header (765 KB record + 747 KB index -> 1.51 MB), and decodeTestCoverage takes the same time with them inside (13.9 vs 14.0 ms). Not done: AC #1's 'no second module table' — the cases section still carries its own module/block table (FIXME in case-record.ts); the seven-MUI corpus measurement is not run.
<!-- SECTION:NOTES:END -->
