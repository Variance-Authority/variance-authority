---
id: TASK-24.3
title: Eyes in the record
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-02 06:01'
updated_date: '2026-10-02 07:35'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Record section 'eyes' (case-record PARTS, additive) laid by layCases/landCases in sense eyes-record.ts: rows {case, attempt, complete, because?, attention}, keyed by the final case id; a file that runs again replaces its rows; absent when none.
2. Playwright: playwright-test installs the case scope in the worker; the eyes fixture hands its journal to the scope; the recorder keys it by ownerOf+testOf and attempt testInfo.retry+1; carried through stage/fold into recordExecution -> landRun.
3. RTL watchTest(screen, identity?) takes the running case from the scope when no identity is given.
4. Remove the eyes reporter, writeEyesArchive and the stage env vars (no aliases).
5. distill reads Eyes from the record (testCoverageFile or --execution); --eyes removed; attempts named; unresolved id refused.
6. Retention: sharedRecord keeps eyes (same machine); share and carry name the Eyes section among what they upload.
7. Changeset, surface, docs; pre-verify and yarn verify.
<!-- SECTION:PLAN:END -->
