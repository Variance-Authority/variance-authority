---
id: TASK-21.14
title: The tech-stack answer is under 1 s warm on Kibana
status: In Progress
assignee: []
created_date: '2026-09-28 03:55'
updated_date: '2026-09-29 10:19'
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
- [x] #1 Warm question time for search with --from, symbol with --from and the words-free stack answer is under 1 s on Kibana and on the seven-copy MUI corpus
- [x] #2 An index run over an unchanged install reuses every catalogue entry and says so
- [x] #3 Cold and warm catalogue refresh times on both corpora are recorded by a *.measure.ts file
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Warm stack, search --from and symbol --from answer in 0.27-0.31 s on Kibana and 0.46-0.69 s on seven Material UIs (median of 3, node start included). Unchanged refresh reuses every entry with something to reuse on Kibana; on MUI x7 12-16 of ~9,300 are recomputed (react under copies 2/5/7, symlinked outside the checkout; cause open, marked TODO). Cold/warm refresh recorded by dependency-scale.measure.ts: Kibana 5.7/4.2 s, MUI x7 16.7/12.7 s.
<!-- SECTION:FINAL_SUMMARY:END -->
