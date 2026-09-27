---
id: TASK-21.3
title: 'Layer 2: journeys in Rust from master''s latest recording'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-27 08:23'
updated_date: '2026-09-27 13:11'
labels: []
dependencies: []
parent_task_id: TASK-21
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Journeys are prepared before the question from master's latest recording and orient reads them; the engine never runs tests. The JS prototype placed 80.9% (Docusaurus), 85.1% (VA), 73.0% (tanstack-query), 59.1% (zod), 36.7% (MUI) of entered functions in call order.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Placed share per repo is at least the prototype's
- [ ] #2 A question reads prepared journeys in milliseconds and runs nothing
- [ ] #3 One implementation, in Rust; no JavaScript fallback
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Baseline: rerun the JS prototype (scratchpad l2/prepare.mjs + orient/lib/{record,callgraph,walk}.mjs) against each repo's current recording; its placed share is the floor per repo (prototype figures: Docusaurus 80.9, VA 85.1, tanstack-query 73.0, zod 59.1, MUI 36.7).
2. Port to the sense addon in Rust: read the recording (cases.bin) of the primary checkout, the source index's relations, and each file's text at the recording's commit (git owns it); walk every case once into placed call edges and per-case package flows. No JS walk, no fallback.
3. Prepare before the question: written next to the recording/index, stamped with the recording and index digests, skipped when neither moved. A question with no prepared journeys says why; it never walks.
4. Read at question time in milliseconds: ask orient --files names who reaches each file's functions and where they go, with case counts and the package flows through it.
5. Gates: placed share >= floor per repo (not Kibana), question read ms, cargo + CLI tests, clean-room review answered, yarn verify green on main.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Rust port on feat/orient-journeys (native/src/journeys*.rs; sense prepareJourneys/journeysAround; variance index prepares; ask orient --files reads, `file:line` asks a line). Placed share equals the rerun JS floor on every repo: Docusaurus 80.9%, VA 84.8% (rerun floor; the description quotes 85.1 from an older recording), tanstack-query 73.0%, zod 59.1%, MUI 36.7%. Prepare (warm runner table): Docusaurus 49 ms / 263 KB, tanstack 103 ms / 334 KB, zod 91 ms / 385 KB, MUI 166 ms / ~580 KB, VA 133 ms / 508 KB; peak RSS 143-884 MB including loading the Vite configs. Question (journeysFor): file ask 0.5-1.6 ms, line ask 10.5-29.3 ms (one git diff -U0). A question never walks: unprepared or stale journeys answer "not prepared" with the reason. Open: MUI test/regressions/vitest.config.ts does not load (__dirname under ESM evaluation), FIXME in packages/sense/src/runner-aliases.ts; clean-room review not yet done.
<!-- SECTION:NOTES:END -->
