---
id: TASK-14
title: Align the lifecycle of Variance Authority information
status: Done
assignee:
  - '@codex'
created_date: '2026-08-25 02:42'
updated_date: '2026-08-25 12:08'
labels: []
dependencies: []
references:
  - docs/architecture.md
  - docs/scenarios.md
  - packages/sense/README.md
  - docs/information.md
modified_files:
  - docs/information.md
  - docs/architecture.md
  - README.md
type: docs
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Define the complete information journey from project inputs and retained prior evidence, through SUT execution, capture, visual comparison, scenarios, report assembly, review, and persistence. State where HTML, pixels, Sense graphs/caches/runtime coverage, source/runtime/scenario journeys, reports, baselines, review decisions, and history live; how they are shared; which values remain ephemeral; and which outputs feed later runs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The document starts where work starts: project definition, source checkout, SUT host, and retained evidence from earlier runs.
- [x] #2 A Mermaid flow follows data through SUT execution, capture/scenario points, rendering, comparison, report assembly, review, and each persisted output, including feedback into later runs.
- [x] #3 HTML, semantic snapshots, pixel caches, run images, and approved baselines have explicit in-process, local, remote, and retention boundaries.
- [x] #4 Sense source graph sections live in a versioned binary source index; runtime coverage, temporary journals, sharing paths, and runner-independent query shapes have explicit storage and exchange rules.
- [x] #5 Source reach trails, runtime crossings, and scenario paths are distinguished, and the report assembly boundary states what the canonical report can and cannot access.
- [x] #6 The document ends with the persisted-result topology and next-run feedback, while preserving exactly create, update, merge, delete, and compound wipe and redefine plus all completeness states.
- [x] #7 Repository documentation checks pass.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reorder the page from starting inputs to persisted outputs. 2. Draw the end-to-end data topology and feedback loops in Mermaid. 3. Document concrete HTML, pixel, Sense binary source-index, runtime, scenario, report, baseline, review, and history placement. 4. Define the report input closure and separate journey meanings. 5. Retain lifecycle and partial-execution rules. 6. Verify the completed documentation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Recast after user readback around chronology and concrete placement. The page starts at project definition/source/SUT/prior evidence; follows execution, captures, rendering, reporting, review, and persistence; describes Sense source information as a versioned binary index with interned names, typed-array sections, and CSR relations rather than JSON cache files; names the report, image, render-cache, and runtime-coverage locations; explains sharing and remote-only stores; separates source, runtime, and scenario journeys; states exactly what RunReport retains; and ends with outputs that feed later runs.

Final validation: yarn build passed. The staged-tree documentation and repository checks passed 6,357/6,357 with one todo. The full behavioral run passed 2,688 tests before one unrelated aggregate stabilization-cost sample measured 20.25 ms against a <20 ms threshold; the isolated file then passed 5/5 with one todo at -0.1 ms measured overhead.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Documented the chronological information lifecycle from project inputs and retained evidence through SUT execution, capture, rendering, comparison, reporting, review, persistence, and next-run feedback. The document locates HTML, pixels, the binary Sense source index, runtime coverage, source/runtime/scenario journeys, reports, baselines, history, and scenarios; defines transfer, sharing, completeness, and exactly five lifecycle operations. Verified against the staged repository with build, 6,357 repository checks, the behavioral suite, and the isolated aggregate performance flake.
<!-- SECTION:FINAL_SUMMARY:END -->
