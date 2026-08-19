---
id: TASK-4
title: Build a graduated evidence example ladder
status: Done
assignee: []
created_date: '2026-08-19 05:04'
updated_date: '2026-08-19 05:36'
labels: []
dependencies: []
priority: high
type: enhancement
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add dedicated, runnable examples for structural change, instability diagnosis, and measurable reuse speed so advanced machinery is not hidden inside five broad fixtures.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A standalone structural-change example distinguishes a pixel-invisible semantic regression from ordinary visual change and states its boundary.
- [x] #2 The real Storybook case demonstrates a named flake diagnosis and its non-acceptance outcome through the CLI.
- [x] #3 A standalone reuse-speed example measures a cold and warm path, verifies the reused result is equivalent, and states what is not cached.
- [x] #4 The repository entry point routes readers from ordinary VR through the examples in increasing complexity.
- [x] #5 Each new or strengthened example has a verified command, showcase, proof, and boundary.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a Chromium structural-change example that contrasts identical pixels with a source-owned semantic structural finding. 2. Strengthen the existing real Storybook case with an end-to-end --flakes diagnosis for its ticking Clock rather than duplicate its integration as a fixture. 3. Add a small cached source-selection example that proves cold and warm scans decide the same affected stories while reporting the speed difference. 4. Route the examples as a simple-to-complex ladder in the root README and verify the examples, build, checks, and full test suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified structural Chromium proof (identical pixels plus semantic AccountCard finding), cached selection proof (304 warm record hits and 0 rebuilds with equivalent selection), real Storybook --flakes CLI refusal, full Vitest suite (170 files, 2263 passing tests, 20 todo), and docs/link/boundary/shape/unrun checks. Fresh independent documentation gate: PASS.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built a simple-to-complex evidence ladder: standalone structural and cached-selection examples, an end-to-end Storybook flake diagnosis/refusal, and a root route that distinguishes the simple progression from broad reference cases. Verified with the full suite, focused browser proofs, static checks, and independent documentation review.
<!-- SECTION:FINAL_SUMMARY:END -->
