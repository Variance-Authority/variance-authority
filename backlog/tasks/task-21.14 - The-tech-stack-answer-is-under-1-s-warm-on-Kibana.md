---
id: TASK-21.14
title: The tech-stack answer is under 1 s warm on Kibana
status: To Do
assignee: []
created_date: '2026-09-28 03:55'
labels: []
dependencies:
  - TASK-21.11
parent_task_id: TASK-21
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The catalogue was timed only on this repository (53 owning manifests, 63 external names, about 1.1 s warm to index). The parent's budget is the whole answer under 1 s warm on Kibana and on the seven-copy MUI corpus. Index refresh cost and question cost are both measured there, and an unchanged install refreshes nothing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Warm question time for search with --from, symbol with --from and the words-free stack answer is under 1 s on Kibana and on the seven-copy MUI corpus
- [ ] #2 An index run over an unchanged install reuses every catalogue entry and says so
- [ ] #3 Cold and warm catalogue refresh times on both corpora are recorded by a *.measure.ts file
<!-- AC:END -->
