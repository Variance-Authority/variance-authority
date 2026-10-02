---
id: TASK-24.2
title: A record without coverage
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-02 06:01'
updated_date: '2026-10-02 07:31'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pin: an uninstrumented run that keeps cases writes coverage.bin with only case sections (fails today: empty module tables are written).
2. Spell the absence: a record whose header holds case sections and none of the coverage sections. openTestCoverage throws RecordWithoutCoverage for it; a partly missing set stays invalid.
3. landRun: a run with no module carries the previous record's coverage under its cases, or writes the case sections alone; it records no commit run and no own layer, because it measured nothing.
4. Readers: variance select answers a no-coverage ground and skips nothing; journeyAgainst narrows nothing on it.
5. Warning, docs (docs/execution-record.md), changeset, surface.
<!-- SECTION:PLAN:END -->
