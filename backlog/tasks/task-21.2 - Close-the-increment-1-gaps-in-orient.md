---
id: TASK-21.2
title: Close the increment-1 gaps in orient
status: To Do
assignee: []
created_date: '2026-09-27 08:23'
updated_date: '2026-09-27 08:25'
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
- [ ] #1 A worktree's partial recording layer no longer shadows master's cases for a file (e.g. `published.ts` shows 82, not 44)
- [ ] #2 `--root` reaches orient in the help binary
- [ ] #3 A file that ran only while its module evaluated names the cases that loaded it
- [ ] #4 Resident memory does not grow per question in a long-lived server
- [ ] #5 The answer is timed on the seven-copy MUI corpus and is under 1 s warm
- [ ] #6 A worktree seeds `coverage.bin.cases.bin` from the primary checkout along with `coverage.bin`, so a test file is never said "not recorded" because of a partial worktree run
<!-- AC:END -->
