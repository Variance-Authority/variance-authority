---
id: TASK-24.2
title: A record without coverage
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-02 06:01'
updated_date: '2026-10-02 08:14'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on feat/record-without-coverage (05996d48, 5ebcb18a). landRun: a run with no module rows lands only its cases (landUncovered) - a case-only record via recordOfCases when no coverage is held, the held coverage carried unchanged otherwise, nothing when it kept no cases, and no runs record. Its incomplete rows still land as coverage, since they select their files. openTestCoverage throws RecordWithoutCoverage when no coverage section is present; a partial set stays broken. CLI: variance select answers no-coverage and skips nothing; run --since and journeys read it as no record; land folds over it and keeps its cases (FIXME: a case-only shard is refused with its cases). AC1: record-without-coverage.test.ts 'writes the record with its case sections and no coverage section'; runner.integration 'says so when no process instrumented anything'. AC2: record-without-coverage.test.ts 'narrows nothing: selection answers that it read no record'; select-without-coverage.test.ts. Open: seeding a worktree from a case-only base record seeds nothing.

Loose ends closed in commit b9b8651f. test:since runs the whole slice on a record with cases and no coverage. Landing such a shard lays its cases and folds nothing. A worktree seeds from such a base. yarn verify green.
<!-- SECTION:NOTES:END -->
