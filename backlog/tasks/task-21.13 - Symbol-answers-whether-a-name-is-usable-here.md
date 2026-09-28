---
id: TASK-21.13
title: Symbol answers whether a name is usable here
status: To Do
assignee: []
created_date: '2026-09-28 03:55'
labels: []
dependencies:
  - TASK-21.9
  - TASK-21.10
parent_task_id: TASK-21
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`ask symbol --name useState --package react` answers what the API says but takes no location, so it cannot say whether the code in hand should use it. With `--from <path>`, symbol resolves the name from that path's owning context: the version installed there, whether the area already imports it, and where in the repository it is usable when it is not usable here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 symbol accepts --from and resolves the installed package from the owning context of that path
- [ ] #2 A name not usable at the path is answered with the workspaces where it is, not with an empty result
- [ ] #3 Two workspaces with different installed versions of one package get their own signature and version
<!-- AC:END -->
