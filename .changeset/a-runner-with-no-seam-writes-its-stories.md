---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A runner recorded through `@variance-authority/sense/runner`, such as `node:test` or Mocha, writes a story for each case under `VARIANCE_AUTHORITY_STORY=1`, as Vitest, Jest and Rstest do.
