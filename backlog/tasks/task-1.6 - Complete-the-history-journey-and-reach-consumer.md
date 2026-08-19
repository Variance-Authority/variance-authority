---
id: TASK-1.6
title: Complete the history journey and reach consumer
status: To Do
assignee: []
created_date: '2026-08-16'
labels: []
dependencies: []
parent_task_id: TASK-1
ordinal: 10600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The history store records runs and approvals and answers recurrence, churn,
and journeys, but `reach` has no caller and the planned eleven-run journey has
not been demonstrated. The implementation and the product evidence are at
different stages, so the accumulated-drift claim remains conditional.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Investigate `lastChanged`, `reach`, the history report path, and the exact eleven-run acceptance journey in spec 0002
- [ ] #2 Confirm the intended consumer and measurement with a bounded repeated-run sequence, or record the missing deployment/input as an explicit boundary
- [ ] #3 Fix the caller, report, and journey coverage, or narrow history claims and leave the unrun marker at the code owner
<!-- AC:END -->
