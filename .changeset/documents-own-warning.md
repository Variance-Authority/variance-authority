---
'@variance-authority/playwright-test': patch
---

On a Playwright client without context instrumentation, the first test in each worker no longer has variance-authority's own warning in its story as a line the test printed.
