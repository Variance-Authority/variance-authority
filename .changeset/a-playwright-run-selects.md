---
'@variance-authority/playwright-test': minor
'@variance-authority/sense': minor
---

A Playwright run selects

A Playwright configuration wrapped in `withTestSelection` now selects: with `VARIANCE_AUTHORITY_SINCE` set, the run drops the spec files the record shows the change did not reach, before Playwright loads one or places a shard, and prints `selected N of M`. A selection that keeps no spec file passes the run. Watch and UI mode and `--list` do not select, and say so. `@variance-authority/sense/test-selection` exports `askedSelection`, the selection a run asks for, which the Jest, Vitest and Playwright seams share.
