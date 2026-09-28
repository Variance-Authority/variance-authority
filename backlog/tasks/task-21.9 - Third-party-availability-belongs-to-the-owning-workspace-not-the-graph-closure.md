---
id: TASK-21.9
title: >-
  Third-party availability belongs to the owning workspace, not the graph
  closure
status: To Do
assignee: []
created_date: '2026-09-28 03:54'
labels: []
dependencies: []
parent_task_id: TASK-21
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Graph-scoped `ask search` offers every dependency declared by any workspace the `from` closure reaches, so Help reaching Eyes through MCP is offered Eyes-only test APIs as "available". A dependency is usable at a location when that location's owning manifest declares it (or the root declares it for a root:* workspace). A dependency owned by a reached workspace is a different fact: it is reachable through that workspace, not usable here. Replaces the FIXME at packages/help/src/tools/search-answer.ts:318.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A third-party name is listed as usable from a path only when the owning manifest of that path, or the root for root:* workspaces, declares it
- [ ] #2 A name declared only by a reached workspace is reported separately as reached through that workspace, with the import path that reached it, or not at all
- [ ] #3 Help -> MCP -> Eyes in this repository no longer offers Eyes-only test APIs as usable from packages/help/src/server.ts
- [ ] #4 The FIXME at search-answer.ts is deleted by the change that fixes it
<!-- AC:END -->
