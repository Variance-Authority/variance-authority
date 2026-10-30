---
'@variance-authority/vitest-browser': minor
---

`@variance-authority/vitest-browser` needs Vitest 5

Vitest 5 removed the `vitest/suite` entry point that `variance()` read the
running test's titles from. It now reads them through `TestRunner` from
`vitest`, and the peer range moves from `>=3` to `^5.0.0`, the major it is
tested on. On Vitest 3 or 4, stay on the previous release.
