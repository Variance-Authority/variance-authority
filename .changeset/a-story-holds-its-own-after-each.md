---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A test's story holds what its own `afterEach` called, under the hook's line, in Vitest, Jest and Rstest as in a page. It used to open the next test's story as `before the test`, and a test recorded alone lost it.
