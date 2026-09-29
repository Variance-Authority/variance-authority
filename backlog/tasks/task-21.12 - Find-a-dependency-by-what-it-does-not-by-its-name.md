---
id: TASK-21.12
title: 'Find a dependency by what it does, not by its name'
status: Done
assignee: []
created_date: '2026-09-28 03:55'
updated_date: '2026-09-29 09:44'
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
- [x] #1 A committed set of at least twenty described jobs, each with the package that should answer it, is checked by a *.measure.ts or *.check.ts file
- [x] #2 "state management" from a React workspace reaches react, and a query naming a job no declared dependency does is answered empty with its scope
- [x] #3 The words indexed come from the installed package and are refreshed with the catalogue, not recomputed at question time
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Each installed package's description, keywords, README headings and the stems of its names are stored in the lexicon (version 7) at refresh; a question by words intersects stems and lists the packages that describe it, or answers empty with its scope. 24 described jobs over 26 invented packages (src/__fixtures__/invented-packages.ts, not real installs): 24/24 reach the expected package in the first three, 23/24 first (invented-jobs.measure.ts).
<!-- SECTION:FINAL_SUMMARY:END -->
