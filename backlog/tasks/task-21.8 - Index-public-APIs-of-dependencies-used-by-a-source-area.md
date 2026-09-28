---
id: TASK-21.8
title: Index public APIs of dependencies used by a source area
status: To Do
assignee: []
created_date: '2026-09-27 23:54'
labels: []
dependencies:
  - TASK-21.7
parent_task_id: TASK-21
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let an agent inspect the public declarations, signatures and JSDoc of external packages this source area uses, including versions older or newer than model training. Resolve the installed package through the project resolver and keep the API corpus separate from source-use evidence; rebuild it when the resolved dependency changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A dependency used in an area has an exact resolved package identity and version when the resolver can supply them; ambiguous or unavailable identity is stated as such.
- [ ] #2 Only public entrypoints from dependencies used by the area are indexed; transitive packages merely present in an installation are excluded.
- [ ] #3 Public names, signatures and JSDoc are queryable as separate evidence from repository imports.
- [ ] #4 A dependency API change refreshes its corpus without requiring a repository source scan, and unchanged dependencies retain their indexed data.
- [ ] #5 The result is checked against this repository and a fixture with an external dependency.
<!-- AC:END -->
