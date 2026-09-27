---
'@variance-authority/playwright-test': minor
'@variance-authority/sense': minor
---

A Playwright run's recording times its spec files and test cases with `testInfo.duration`

Each test's `testInfo.duration` — the body, its `beforeEach` hooks and the fixtures set up for it — is recorded on its case in the case index and summed onto its spec file in the coverage file, so `variance ask slowest-tests` ranks Playwright tests beside Vitest, Jest and Rstest ones. A retried test is timed as the sum of its attempts. A run whose workers stage their contributions carries the durations, and each case's retry outcome, through the fold the reporter makes.
