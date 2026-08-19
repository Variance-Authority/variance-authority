---
id: TASK-7
title: Make adopter-facing integrations additive
status: Done
assignee:
  - '@codex'
created_date: '2026-08-19 09:57'
updated_date: '2026-08-19 10:19'
labels: []
dependencies: []
modified_files:
  - packages/playwright-test
  - packages/storybook-collector
  - README.md
priority: high
type: enhancement
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
End users must be able to add Variance Authority to an existing Playwright or Storybook setup without transferring ownership of the host framework. The current playwright-test surface requires replacing the suite test and expect imports; that is a hard adoption blocker. The Storybook path must remain parallel to Storybook and must not modify its configuration in the common path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Playwright test keeps importing test and expect from its existing owner while invoking Variance through an additive API
- [x] #2 Suites that already own a shared fixture layer can compose Variance into that layer without importing a package-owned test or expect
- [x] #3 The supported Storybook path consumes a built or served Storybook without requiring changes to Storybook configuration or build behavior
- [x] #4 Public documentation demonstrates additive integration and does not advertise framework replacement
- [x] #5 Local build, repository checks, and tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Freeze the additive-adoption contract against the current exported surfaces and tests. 2. Remove package-owned test and expect exports; extract direct observation/assertion APIs and optional composable fixture/matcher pieces. 3. Recheck Storybook and route collectors for host-process interference, narrowing or correcting any violating common path. 4. Update public examples and enforce the adoption boundary in compilation/tests. 5. Run the complete local build, check, and test gate and repair separately bounded gating defects in the current checkout.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: immutable install completed; build generated 32 documentation examples, three page-agent bundles, and 37 tribunal migrations; repository checks passed 2,480 tests with one explicit todo; full browser-enabled suite passed 2,274 tests across 174 files with 20 explicit todos. The consumer browser test imports test and expect only from @playwright/test. Storybook collector remains an artifact consumer and its readiness allowance is collector-owned.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed package-owned Playwright test and expect exports, added direct observation/assertion APIs plus unbound fixture and matcher composition, retained Storybook as a parallel artifact consumer, and documented the host-ownership boundary. Verified with the repository's immutable install, build, and full verify sequence, including real Chromium cases.
<!-- SECTION:FINAL_SUMMARY:END -->
