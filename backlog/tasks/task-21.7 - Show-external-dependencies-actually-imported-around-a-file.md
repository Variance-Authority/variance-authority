---
id: TASK-21.7
title: Show external dependencies actually imported around a file
status: Done
assignee:
  - '@akorzunov'
created_date: '2026-09-27 23:54'
updated_date: '2026-09-28 00:20'
labels: []
dependencies: []
parent_task_id: TASK-21
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Orient a reader from a file to external packages used by its owning source area. Import records are evidence of use; manifest declarations are context, including root declarations used by root:* workspaces. Keep areas separate so dependencies used by tooling or another product domain do not appear as local use.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A file-scoped answer names external package imports from the owning area with source evidence and stable counts.
- [x] #2 Declared but unimported dependencies are distinguished from observed imports, and unknown or unreadable imports are not reported as absent.
- [x] #3 A repository using root:* declarations and no internal lockfile entries still reports imports from its code.
- [x] #4 The answer from this repository is checked against its own source imports and does not mix unrelated areas.
- [x] #5 The question reads a published index and does not scan source text at question time.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the published source index in the native scanner, walk imports from the files asked about, and return external package imports with their source paths and declaration context. 2. Add that reading to file-scoped orient without reading source text at question time; distinguish unread and declared-only states. 3. Exercise a root:* fixture and this repository as the first consumer, then run build and the repository verification gate.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Compass Consume finding: external dependency orientation is not named by the current Reach or Agent surface chart. This is a semantic extension, not evidence that the existing source-index boundary already includes installed public APIs; chart work remains a separate Create task.

Verified: the root:* fixture sees code imports without node_modules or internal lockfile entries; self orientation on packages/help/src/index.ts sees oxc-parser, oxc-resolver and picomatch with source locations, while packages/react/src/wiring.test.tsx sees its own React and Vitest imports. Focused orient and CLI tests pass; build, lint, check (17,724 tests) and measure pass. Full test suite: 607 files passed, 4 failed in Storybook/browser engine cases unrelated to this change.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added file-scoped external dependency orientation from the published source index, with import sites, local/root manifest context, declared-only names and incomplete-reading signals. Verified with a root:* fixture, this repository, focused tests, build, lint, check and measure.
<!-- SECTION:FINAL_SUMMARY:END -->
