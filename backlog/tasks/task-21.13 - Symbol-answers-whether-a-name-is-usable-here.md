---
id: TASK-21.13
title: Symbol answers whether a name is usable here
status: Done
assignee: []
created_date: '2026-09-28 03:55'
updated_date: '2026-09-29 08:21'
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
- [x] #1 symbol accepts --from and resolves the installed package from the owning context of that path
- [x] #2 A name not usable at the path is answered with the workspaces where it is, not with an empty result
- [x] #3 Two workspaces with different installed versions of one package get their own signature and version
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`symbol --from <path>` resolves the installed package under the manifest that owns the path, answers a name not usable there with the workspaces that offer it, and gives two workspaces on different versions of one package their own version and signature. Covered by symbol-from.test.ts.
<!-- SECTION:FINAL_SUMMARY:END -->
