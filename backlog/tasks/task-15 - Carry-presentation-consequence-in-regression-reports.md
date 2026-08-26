---
id: TASK-15
title: Carry presentation consequence in regression reports
status: Done
assignee: []
created_date: '2026-08-26 09:45'
updated_date: '2026-08-26 09:46'
labels: []
dependencies: []
documentation:
  - docs/presentation.md
  - packages/report/README.md
  - packages/presentation/README.md
modified_files:
  - packages/report/src/format.ts
  - packages/presentation/src/report.ts
  - packages/cli/src/commands/record.ts
  - packages/mcp/src/presentation.ts
type: feature
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A run report retains the presentation consequence of an edit as an independent signal so a hierarchy failure remains available after browser acquisition without changing renderer impact or the observation verdict.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A report distinguishes an absent presentation reading, an incomparable reading, and a comparable reading with no effects
- [x] #2 Comparable readings classify introduced, resolved, and measurement-changing persisted presentation effects with their structural evidence
- [x] #3 Report files, Tribunal storage, HTML, and agent text preserve and expose the same presentation signal independently of verdict
- [x] #4 Public APIs and documentation explain the boundary and automated tests exercise serialization and readers
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Define the independent report signal and validation. 2. Project presentation comparisons into transitions. 3. Carry it through collectors, storage, HTML, and agent text. 4. Document and verify the public boundary.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the report schema, presentation projection, CLI and MCP readers, Tribunal round-trip coverage, ADR, package documentation, and skill guidance. Verification: yarn build, yarn check (6,596 checks), focused tests (95 passed, 1 todo), and a compiled consumer proof. Full verify reached 2,480 passing tests; 41 browser tests were blocked by Chromium Mach-port permission in the sandbox.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Stored presentation consequence as a first-class independent report signal. The report records introduced, resolved, and measurement-changing persisted effects with structural measurements, preserves absent versus incomparable versus measured-empty states, round-trips through JSON and Tribunal storage, and renders in HTML and agent summaries without changing the regression verdict. Verified with build, 6,596 repository checks, 95 focused passing tests plus 1 todo, and a compiled consumer proof; the remaining full-suite failures are sandbox-blocked Chromium launches.
<!-- SECTION:FINAL_SUMMARY:END -->
