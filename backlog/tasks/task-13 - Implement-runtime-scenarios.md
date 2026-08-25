---
id: TASK-13
title: Implement runtime scenarios
status: Done
assignee:
  - '@codex'
created_date: '2026-08-25 01:00'
updated_date: '2026-08-25 01:34'
labels: []
dependencies:
  - TASK-12
references:
  - docs/scenarios.md
  - docs/context/adr/0047-a-runtime-scenario-is-a-witnessed-path.md
  - docs/context/adr/0048-a-scenario-archive-holds-semantic-objects.md
modified_files:
  - packages/scenario
  - docs/scenarios.md
  - docs/context/adr/0047-a-runtime-scenario-is-a-witnessed-path.md
  - docs/context/adr/0048-a-scenario-archive-holds-semantic-objects.md
  - docs/architecture.md
  - docs/specs/README.md
  - docs/context/checkpoint.md
  - tsconfig.json
  - yarn.lock
  - tools/surface.baseline.json
type: feature
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build spec 0034 as a checked runtime-scenario state-machine contract, assessment engine, and opt-in text archive over named precondition observations.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Executions record Arrange and observed or explicitly unobserved Act outcomes without synthesizing absent frames.
- [x] #2 Assessments separate Arrange variation, transition effects, execution divergence, and unmatched authored Act identities.
- [x] #3 Executions fold into a partial machine that preserves convergence, branching, and unknown transitions.
- [x] #4 An opt-in text archive deduplicates canonical semantic snapshots, survives process restart, enforces retention admission, and stores no raster or raw Act values.
- [x] #5 Profile mismatch retains unobservable bands and names the blind side.
- [x] #6 The package API is documented, exercised, built, and repository verification passes.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a dedicated @variance-authority/scenario package whose checked definition/execution builders make Arrange, Act, observed/unobserved outcomes, and terminal prefixes explicit.
2. Implement pure assessment and machine folding over snapshot-backed frames, keeping Arrange variation, transition effects, cross-execution divergence, unmatched Act identities, profile observability, and unknown edges distinct.
3. Implement an opt-in filesystem text archive with canonical snapshot addressing, atomic manifests, deduplication, admission/retention policy, expiration diagnostics, and no raster or raw event payload surface.
4. Document and exercise the public API, update workspace/spec/checkpoint bookkeeping, then run build and full verification.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented @variance-authority/scenario with branded checked definitions/executions/runs, explicit observed/unobserved outcomes, effect-based pair assessment, sided unmatched Acts, and partial-machine folding. Added the opt-in canonical semantic archive with address, admission/retention/access/deletion policy, deduplication, expiry, and garbage collection. Discharged spec 0034 into ADR-0047, ADR-0048, docs/scenarios.md, package README, architecture inventory, and checkpoint. Fresh-context readback found and drove the branded runtime-validation boundary.

Verification: yarn build passed; lint passed; repository checks passed 6,290/6,290 with 1 todo; the complete behavioral suite passed serially with 216 files passed, 4 skipped, 2,671 tests passed, 51 skipped, and 23 todo. The default parallel aggregate twice starved unrelated Chromium beforeAll hooks; both affected suites passed in isolation, and the full one-worker suite passed. Scenario-focused tests passed 14/14. git diff --check passed. Fresh-context nominal-boundary readback: PASS.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented spec 0034 as @variance-authority/scenario. AAA executions are checked terminal witnessed paths: Arrange selects a named precondition, stable Act identities record observed or explicitly unobserved outcomes, and assessment separately reports Arrange variation, transition effects, cross-execution divergence, and unmatched steps. Executions fold into a partial state machine with branching, convergence, and unknown edges. An explicit inquiry-only archive stores versioned canonical semantic snapshots and manifests with deduplication, restart reads, admission/retention/access/deletion policy, expiry, and garbage collection; it has no raster, raw event payload, baseline, history, approval, verdict, or exit-code surface. Product documentation and ADRs replace discharged spec 0034.
<!-- SECTION:FINAL_SUMMARY:END -->
