---
id: TASK-21.12
title: 'Find a dependency by what it does, not by its name'
status: To Do
assignee: []
created_date: '2026-09-28 03:55'
labels: []
dependencies:
  - TASK-21.9
parent_task_id: TASK-21
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The catalogue finds `useState` from "stateful value" because those words are in its JSDoc, and finds nothing for "state management". An agent describes a job, not an identifier. Package descriptions and keywords from installed manifests, README headings, and JSDoc words are indexed at `variance index` time so a described job reaches the package and the names that do it. Measured against a fixed set of described jobs with expected packages, so a change to ranking shows up as a number.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A committed set of at least twenty described jobs, each with the package that should answer it, is checked by a *.measure.ts or *.check.ts file
- [ ] #2 "state management" from a React workspace reaches react, and a query naming a job no declared dependency does is answered empty with its scope
- [ ] #3 The words indexed come from the installed package and are refreshed with the catalogue, not recomputed at question time
<!-- AC:END -->
