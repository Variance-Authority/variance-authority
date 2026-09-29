---
id: TASK-21.4
title: 'Layer 1 edges carry traffic, barrels and case flows'
status: In Progress
assignee: []
created_date: '2026-09-27 08:23'
updated_date: '2026-09-29 13:18'
labels: []
dependencies: []
parent_task_id: TASK-21
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Package edges say how many recorded cases crossed them, which barrel carried a name, and which cases flowed where. Co-entry is not an observed crossing, so every figure names its observation class and a base rate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each edge figure is labelled observed, co-entry or inferred
- [ ] #2 The barrel share is reported only if it survives its base-rate control on zod, VA, Docusaurus and MUI
- [x] #3 "Traffic" is renamed to cases that entered both ends; no output calls co-entry a crossing
- [x] #4 `export *` fan-out no longer routes a name to a file that does not declare it
- [ ] #5 The judgeable share leaves imports of built output out of its denominator
- [x] #6 A takes-from share prints its count beside it, and is absent below a floor
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shares print their count (X% (n), or 'n of m' under a denominator of 10); legend says 'Observed in source'; case flows say 'Observed: N of M cases entered X' and 'entered it and other packages ... co-entry and not a crossing'. #4: export-star fan-out test added (journeys_graph_tests.rs), passes: the graph routes a name only to the declaring file. #2 and #5 left unchecked: no barrel share and no judgeable share exists in the output or code to control or re-denominate, so there is nothing to verify; needs the figure to exist first.
<!-- SECTION:NOTES:END -->
