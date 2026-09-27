---
id: TASK-21
title: Complete the orientation engine
status: To Do
assignee: []
created_date: '2026-09-27 08:22'
labels: []
dependencies: []
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An agent with a few files in hand asks `variance ask orient` and gets, in under a second warm on Kibana, what the code around them is: the owning packages and the names crossing their edges (layer 1, the weighted package graph from the source index), and the journeys that ran through them (layer 2, prepared from master's latest recording before any question). Orient reads graph data only; finding files is the job of `search`, `symbol` and `grep`. Increment 1 (layer 1 + recorded cases) is on main at 46cb4afe.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each subtask is on local main with `yarn build && yarn verify` green after it
- [ ] #2 The whole answer, end to end, is under 1 s warm on Kibana and on the seven-copy MUI corpus
- [ ] #3 Nothing in orient reads a file's text or runs a test at question time
<!-- AC:END -->
