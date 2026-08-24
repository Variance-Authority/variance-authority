---
id: TASK-11
title: Carry causal test-selection evidence in instrumentation and coverage format
status: Done
assignee:
  - '@codex'
created_date: '2026-08-24 11:36'
updated_date: '2026-08-24 12:40'
labels: []
dependencies: []
references:
  - docs/specs/0028-the-instrument.md
  - docs/specs/0029-what-a-run-remembers.md
  - docs/specs/0030-a-diff-lands-on-blocks.md
modified_files:
  - packages/sense/README.md
  - packages/sense/src/instrument/blocks.ts
  - packages/sense/src/instrument/index.ts
  - packages/sense/src/instrument/instrument.test.ts
  - packages/sense/src/instrument/walk.ts
  - packages/sense/src/test-selection/deviation.test.ts
  - packages/sense/src/test-selection/format-validation.ts
  - packages/sense/src/test-selection/format.test.ts
  - packages/sense/src/test-selection/format.ts
  - packages/sense/src/test-selection/index.test.ts
  - packages/sense/src/test-selection/index.ts
  - packages/sense/src/test-selection/vitest.integration.test.ts
  - packages/sense/src/test-selection/vitest.test.ts
  - packages/sense/src/test-selection/vitest.ts
  - packages/sense/test/fixtures/external-vitest/test/alpha.case.ts
  - packages/sense/test/fixtures/external-vitest/vitest.config.ts
  - tools/surface.baseline.json
type: enhancement
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the Sense execution artifact capable of supporting a useful agentic test-selection loop. Instrumentation must describe which execution regions are preconditions of later decisions, and persisted coverage must distinguish current complete observations from stale, partial, or foreign ones. This task establishes the artifact contract only; selection-policy changes consume it later.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Instrumented block metadata represents the causal ownership needed to invalidate decisions dominated by an earlier changed region
- [x] #2 The persisted coverage format records source identity, instrumentation identity, and observation completeness without representing absence as an empty test set
- [x] #3 Changed test, mock, hook, setup, and new-test situations can be represented without requiring syntax-specific fields in the core coverage row
- [x] #4 Binary format round-trips the new state deterministically and refuses incompatible snapshots
- [x] #5 Focused tests cover causal block metadata and every new binary column/state
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add locally visible causal ownership and source/instrumentation identities to the pure instrument artifact.
2. Replace the coverage snapshot contract with version 2: named test observations, generic precondition identities, completeness, module source identities, instrumentation availability, and block owners.
3. Encode and validate the new state as deterministic typed-array columns; completed observations replace, partial observations widen within a generation, and changed preconditions retire inherited crossings.
4. Update the public contract and focused fixtures; verify the package and repository; pass a fresh-context structural readback.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the artifact slice: regions carry owner and own-source digest; instrument results carry source and instrumentation identities; coverage format v2 stores generic per-test preconditions, completeness, module source identities, block ownership/digests, and rejects v1; completed test observations replace old crossings while partial observations only union. Focused TypeScript build and 59 Sense tests pass, including the external Vitest fixture.

Final validation: yarn build passed; all Sense tests passed (121/121); yarn lint and yarn check passed (6,188 checks plus one todo). A full yarn verify reached 2,650 passing tests but two unrelated Storybook timing cases failed; both passed when immediately rerun together in isolation (14 passed, 8 todo). Fresh-context readback recovered the causal rule and drove fixes for generation mixing, explicit instrumentation refusal, structural binary validation, and payload section bounds. Concurrent-writer serialization remains a separate persistence-protocol concern and no follow-up task was opened without user approval.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Instrumented regions now carry causal owners and own-source identities; coverage v2 records complete/partial test generations, generic preconditions, instrumentation/source identity, and explicit module instrumentation refusal. Merge refuses evidence across changed preconditions or owner chains, binary decoding validates its full structural boundary, and focused plus package-wide tests verify the contract.
<!-- SECTION:FINAL_SUMMARY:END -->
