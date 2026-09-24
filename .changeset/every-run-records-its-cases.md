---
'@variance-authority/sense': minor
'@variance-authority/playwright-test': minor
'@variance-authority/storybook-collector': minor
'@variance-authority/cli': patch
---

Every run records which case entered each region. The `cases` option is removed
from `withTestSelection` for Vitest, Jest and Rstest, from the Playwright
recorder and reporter, and from the Storybook recorder: each writes
`<coverage file>.cases.bin` beside the file-level snapshot, or `executionFile`
when you name one. A test file that runs in a page is still recorded per file,
and says so.

Without `continuations: true`, a file whose cases overlap no longer fails the
run. It is recorded as a whole, so a change it reaches runs every case in it, and
the run names the two cases that were open at once.
