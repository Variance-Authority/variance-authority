---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
'@variance-authority/playwright-test': minor
'@variance-authority/storybook-collector': minor
---

Declare the test suites your repository runs, each with its kind, under `suites` in the root `variance.config.json`: `{ "suites": { "unit": { "kind": "unit" }, "stories": { "kind": "visual" } } }`. The kind is one of `unit`, `integration`, `e2e` and `visual`. Each declared suite records on its own, under `suites/<name>/` in the cache, with its case index and runs log beside it, so a run of one suite never replaces what another recorded. A worktree seeds each suite from the same suite in the primary checkout.

Every recording integration takes a `suite` option: the Vitest, Jest and Rstest seams, `startRecording`, `recordExecution`, the Playwright reporter and `varianceExecution`, and the Storybook collector's `tests`. Once `suites` is declared, a run that names no suite, names one the file does not declare, or names both a suite and a `coverageFile` stops before it starts. A repository that declares no suites keeps its one record. `testCoverageFile` and `readableTestCoverage` take `{ suite, cacheRoot }` as their second argument, where they took a bare `cacheRoot` string, and `declaredSuites`, `parseSuites`, `recordFileFor`, `SUITE_KINDS` and `SuitesError` are exported from `@variance-authority/sense/test-selection`. The CLI refuses `suites` in a config file below the repository root.
