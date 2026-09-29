---
id: TASK-21.2
title: Close the increment-1 gaps in orient
status: To Do
assignee: []
created_date: '2026-09-27 08:23'
updated_date: '2026-09-29 13:06'
labels: []
dependencies: []
parent_task_id: TASK-21
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Defects found while landing increment 1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A worktree's partial recording layer no longer shadows master's cases for a file (e.g. `published.ts` shows 82, not 44)
- [x] #2 `--root` reaches orient in the help binary
- [x] #3 A file that ran only while its module evaluated names the cases that loaded it
- [x] #4 Resident memory does not grow per question in a long-lived server
- [x] #5 The answer is timed on the seven-copy MUI corpus and is under 1 s warm
- [x] #6 A worktree seeds `coverage.bin.cases.bin` from the primary checkout along with `coverage.bin`, so a test file is never said "not recorded" because of a partial worktree run
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PR 24 (stacked on 23). #1/#6: worktree seeds .cases.bin; nearest layer read. #2: help --root test. #3: journey_loaders.rs importer closure (no mock exclusion). #4: orient-memory.measure.ts, +2.2 MB over 300 questions. #5: orient 572 ms MUIx7 / 632 ms Kibana warm, with fsmonitor+untracked cache given by env; unaccelerated is 4-6 s because orient runs git status twice (TODO in help orient.ts).
<!-- SECTION:NOTES:END -->
