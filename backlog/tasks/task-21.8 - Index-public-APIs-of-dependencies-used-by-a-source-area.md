---
id: TASK-21.8
title: Index public APIs of dependencies used by a source area
status: Done
assignee:
  - '@akorzunov'
created_date: '2026-09-27 23:54'
updated_date: '2026-09-28 00:41'
labels: []
dependencies:
  - TASK-21.7
parent_task_id: TASK-21
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let an agent inspect the public declarations, signatures and JSDoc of external packages this source area uses, including versions older or newer than model training. Resolve the installed package through the project resolver and keep the API corpus separate from source-use evidence; rebuild it when the resolved dependency changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A dependency used in an area has an exact resolved package identity and version when the resolver can supply them; ambiguous or unavailable identity is stated as such.
- [x] #2 Only public entrypoints from dependencies used by the area are indexed; transitive packages merely present in an installation are excluded.
- [x] #3 Public names, signatures and JSDoc are queryable as separate evidence from repository imports.
- [x] #4 A dependency API change refreshes its corpus without requiring a repository source scan, and unchanged dependencies retain their indexed data.
- [x] #5 The result is checked against this repository and a fixture with an external dependency.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Use the external import sites already published by orient to identify the exact specifiers and importer directories to resolve. 2. Resolve installed public type entrypoints through the project resolver; record package identity/version or an explicit unavailable reason. 3. Build a separate persistent API corpus from public declarations, signatures and JSDoc, keyed by resolved entrypoint content, and refresh it explicitly without rescanning source. 4. Expose a query that joins current use evidence to that corpus, then verify against a fixture and this repository.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified on this checkout: index --api packages/help/src/index.ts resolved oxc-parser@0.144.0, oxc-resolver@11.24.2, and picomatch@4.0.7 with @types/picomatch@4.0.3; a repeat reused all 9 requests. The fixture kept fancy-lib out when only state-kit was imported; changing only the declaration file rebuilt the API entry while the source index stayed as published. The CLI orientation shows imported signatures and JSDoc; the separate dependency-api.json keeps full public entries. Build, lint, check (17,750 tests), measure, and 34 focused tests pass. Full test suite with Chromium and two workers: 609 files passed, four browser case files failed (three Storybook fixture cases and one test requiring multiple engines), with no dependency feature failures.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added an explicitly refreshed dependency API corpus keyed to external requests observed in source, with exact installed runtime and declaration-provider versions, public names, signatures and JSDoc. Verified on a fixture and this repository, including unchanged reuse and declaration-only refresh.
<!-- SECTION:FINAL_SUMMARY:END -->
