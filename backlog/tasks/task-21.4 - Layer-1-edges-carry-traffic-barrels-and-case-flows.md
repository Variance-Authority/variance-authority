---
id: TASK-21.4
title: 'Layer 1 edges carry traffic, barrels and case flows'
status: To Do
assignee: []
created_date: '2026-09-27 08:23'
updated_date: '2026-09-27 08:25'
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
- [ ] #1 Each edge figure is labelled observed, co-entry or inferred
- [ ] #2 The barrel share is reported only if it survives its base-rate control on zod, VA, Docusaurus and MUI
- [ ] #3 "Traffic" is renamed to cases that entered both ends; no output calls co-entry a crossing
- [ ] #4 `export *` fan-out no longer routes a name to a file that does not declare it
- [ ] #5 The judgeable share leaves imports of built output out of its denominator
- [ ] #6 A takes-from share prints its count beside it, and is absent below a floor
<!-- AC:END -->
