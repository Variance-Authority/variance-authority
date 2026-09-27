---
id: TASK-21.6
title: 'The code map: the package graph in areas, a page at a time'
status: Done
assignee: []
created_date: '2026-09-27 11:33'
updated_date: '2026-09-27 11:33'
labels: []
dependencies: []
parent_task_id: TASK-21
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An agent new to a repository runs `variance ask orient` and gets a top page of about a dozen areas of packages, each with size, dependency-layer range, the packages outside imports land on (front) and the areas it uses; `--area <id>` opens one level down, and the deepest pages list packages. Page size does not grow with the package count. Prepared by `variance index` beside the source index; a question only reads it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A warm `variance ask orient` on Kibana answers in under 1 s
- [x] #2 A `variance index` with nothing changed does not rebuild the map and re-lists nothing
- [x] #3 An absent map is said to be absent with the command that prepares it, never printed empty
- [x] #4 Graph logic is Rust only; the same index gives the same bytes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Kibana (1504 packages, 338 areas, 4 deep, 68 layers): warm ask orient 0.13–0.14 s; map share of a no-change variance index 34 ms, carrying the scan listing. No-map, kept-map and same-bytes cases covered by ask-orient.test.ts, index-command.test.ts and orient_map cargo tests (10, run by hand; yarn verify runs no cargo). A context-free agent used the prototype pages on five Kibana tasks: 4 right, 1 near (Lens).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Code map landed on main at 51e2677c, bc4ff018, 50575528 after a clean-room review (12 repairs). Verified with yarn build && yarn verify on main: check 27 files / 17,720 passed, measure green, test 612 files / 6,632 passed / 48 todo.
<!-- SECTION:FINAL_SUMMARY:END -->
