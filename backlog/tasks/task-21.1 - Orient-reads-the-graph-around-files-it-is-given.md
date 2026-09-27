---
id: TASK-21.1
title: Orient reads the graph around files it is given
status: In Progress
assignee: []
created_date: '2026-09-27 08:23'
updated_date: '2026-09-27 08:25'
labels: []
dependencies: []
parent_task_id: TASK-21
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`variance ask orient` takes `--files` (MCP `docs_orient` takes `files`) and no longer searches text: the per-word git grep cost 14.8 s on Kibana. Finding a file belongs to `search`, `symbol` and `grep`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Without files it is refused, naming `search`, `symbol` and `grep` as the questions that find them
- [x] #2 Every file asked about is answered in order: its package, no package, or not in the source index; none is dropped
- [x] #3 No code path in orient opens a file or runs git grep
- [x] #4 Warm on Kibana with three files the whole answer is under 1 s
- [x] #5 Public docs and the skill reference show a sample printed by the binary
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Formatter and tests take files. 2. Docs, skill, README and surface baseline. 3. build, lint, check, test:since main 0-2. 4. Time on Kibana. 5. Commit, fast-forward main, verify on main.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Warm on Kibana, three files: 0.60–0.79 s end to end, about 285 MB (was 14.8 s with the per-word grep). Near tests: 16 files, 382 passed; lint and check green.
<!-- SECTION:NOTES:END -->
