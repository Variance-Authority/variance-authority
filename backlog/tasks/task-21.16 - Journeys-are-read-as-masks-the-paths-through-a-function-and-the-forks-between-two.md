---
id: TASK-21.16
title: >-
  Journeys are read as masks: the paths through a function and the forks between
  two
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 03:41'
updated_date: '2026-09-29 03:52'
labels: []
dependencies: []
parent_task_id: TASK-21
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A journey is the mask of blocks one test entered. Two calculations over a recording, in the sense addon (Rust), with operations layered on top: (1) the paths through a function — its tests partitioned by which of its inner blocks they entered; the majority path is passage, a minority path is a purpose and its smallest test is its story; (2) the forks between two functions — the smallest journey holding both is the connection, journeys reaching one end and sharing half of a connecting one are near misses, and the blocks whose function most of both groups ran and that separate them by at least half are the condition. No recorded callers are read. Validated in throwaway JS across this repo, zod, TanStack Query and MUI (TASK-21.15 notes).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 pathsThrough(root, file, line) answers every path through the innermost recorded function at that line, each with its tests, the blocks it entered and its smallest test, majority first
- [x] #2 forksBetween(root, a, b) answers the connection, each side's near misses and the forks ranked by separation, and says when too few journeys connect to separate
- [x] #3 Both are one Rust implementation in the sense addon, reachable from @variance-authority/sense, with Rust and TS tests
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. journey_masks.rs: a recording read as masks — every region a bit, each region's function, sets expanded once, journey sizes, masks of chosen cases.
2. journey_paths.rs: pathsThrough — partition a function's cases by the regions written in it that they entered; majority is passage.
3. journey_forks.rs: forksBetween — clusters by mask, connection, near misses (>=50% overlap), forks separating by >=50%, thin under 3 connecting cases.
4. napi entries + TS wrappers in sense/journeys.ts; Rust and TS tests.
5. Check against the JS prototype on this repo, zod and MUI.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Rust matches the JS prototype exactly on rankRegions<->settle (this repo: 61/72/42, forks at observe-one.ts:153/178/212…, same nearly case) and on zod _getMessage<->flattenError (832/20/2, 808 journeys, 208/18 near; thin at 2 connecting). 4-7 ms per question against seconds in JS.
MUI styleFunctionSx: 4043 cases, passage 4004 (as in JS), but 3 paths where purpose.mjs found 6 — the prototype counted branches of closures written inside the function; the Rust reading gives each region to the smallest function holding it, so a closure's branches are the closure's paths, not its parent's.

Validation: yarn build && yarn verify green (618 files, 6669 tests); 5 Rust unit tests (cargo test --lib journey_masks, lazy napi linking) and the 'journeys read as masks' TS test pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added journey_masks.rs (a recording read as masks), pathsThrough (journey_paths.rs) and forksBetween (journey_forks.rs) to the sense addon, exported from @variance-authority/sense. Verified against the JS prototype on this repo and zod (identical), MUI (passage identical; closure branches now belong to the closure). 4-7 ms per question. Gate green.
<!-- SECTION:FINAL_SUMMARY:END -->
