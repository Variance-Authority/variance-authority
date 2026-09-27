---
id: TASK-21.5
title: 'Compose orient with search, symbol and grep'
status: To Do
assignee: []
created_date: '2026-09-27 08:23'
labels: []
dependencies: []
parent_task_id: TASK-21
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Only after orient stands alone: an agent goes from words to files through the precomputed search endpoints, then to orient, in one flow. Orient itself never searches.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A question that starts from words reaches an orient answer without any raw text scan outside `grep`
- [ ] #2 Orient still takes files, not words
<!-- AC:END -->
