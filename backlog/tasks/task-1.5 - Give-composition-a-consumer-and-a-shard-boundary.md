---
id: TASK-1.5
title: Give composition a consumer and a shard boundary
status: To Do
assignee: []
created_date: '2026-08-16'
labels: []
dependencies: []
parent_task_id: TASK-1
ordinal: 10500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Composition now measures echoes, divergences, and unexplained movement, but
the checkpoint records that the shortlist has no consumer and that composition
does not survive a shard split. A capability that only exists inside one local
run cannot support the broader review and sweep claims until its merge or
non-goal is explicit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Investigate the composition output, report/CLI consumers, shard merge path, and open relation spec 0025
- [ ] #2 Confirm one useful consumer workflow and one shard or multi-run case, recording whether the current findings remain sound across the boundary
- [ ] #3 Fix the consumer and merge path, or make the local-run-only boundary explicit in code markers, specs, and public claims
<!-- AC:END -->
