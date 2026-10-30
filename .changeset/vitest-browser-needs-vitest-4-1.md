---
'@variance-authority/vitest-browser': minor
'@variance-authority/sense': patch
---

`@variance-authority/vitest-browser` runs on Vitest 5, and needs Vitest 4.1 or newer

Vitest 5 removed the `vitest/suite` entry point that `variance()` read the
running test's titles from. It now reads them through `TestRunner` from
`vitest`, which Vitest 4.1 is the first to export, so the peer range moves from
`>=3` to `>=4.1.0`. On Vitest 3 or 4.0, stay on the previous release.

`@variance-authority/sense` imports its Vitest types from entry points Vitest 5
still has, and its peer range is unchanged.
