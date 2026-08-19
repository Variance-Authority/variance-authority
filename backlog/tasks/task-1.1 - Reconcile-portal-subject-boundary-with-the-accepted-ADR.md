---
id: TASK-1.1
title: Reconcile the portal subject boundary with the accepted ADR
status: To Do
assignee: []
created_date: '2026-08-16'
labels: []
dependencies: []
parent_task_id: TASK-1
ordinal: 10100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`docs/context/adr/0007-subject-boundary-is-the-component-tree.md` accepts the
component subtree wherever it lands, including portals. The kitchen-sink
corpus still labels `dialog-open/dialog` as contested using the superseded
rationale that no subject-boundary decision exists, and the full corpus test
continues to exclude it. The repository therefore reports a settled boundary
as unresolved.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Investigate the ADR, corpus marker, collector traversal, and exclusion test to identify the actual portal behavior and owner
- [ ] #2 Confirm the behavior with a focused portal collection and state whether the contested case is a valid subject under ADR-0007
- [ ] #3 Fix the stale marker/exclusion and its evidence, or replace the ADR with a current decision if the implementation disproves it
<!-- AC:END -->
