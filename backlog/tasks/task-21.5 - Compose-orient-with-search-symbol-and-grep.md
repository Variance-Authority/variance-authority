---
id: TASK-21.5
title: 'Compose orient with search, symbol and grep'
status: Done
assignee: []
created_date: '2026-09-27 08:23'
updated_date: '2026-09-29 13:19'
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
- [x] #1 A question that starts from words reaches an orient answer without any raw text scan outside `grep`
- [x] #2 Orient still takes files, not words
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
search's answer ends with 'variance ask orient --files <located file>' when it located a file (search.ts), tested in search-answer.test.ts; orient's inputs remain files and area only (orient.ts), no search call inside it.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Words reach orient through the precomputed search answer's hand-off line; orient never searches. Verified by search-answer.test.ts and the help/cli suites (1444 passed).
<!-- SECTION:FINAL_SUMMARY:END -->
