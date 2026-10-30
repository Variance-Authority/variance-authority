---
'@variance-authority/playwright-test': minor
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

A case in a page writes a story, and a comparison names a test line that changed

With `VARIANCE_AUTHORITY_STORY=1`, a Playwright case and a Vitest case in browser mode now write a test story, as a Node case does: the code the page ran, in order, with each statement of the test opening what the page did next with its line. Node stories carry the same `test line N` notes. A test body registered through `test.extend` or under an imported alias is cut too, and a Playwright `beforeEach` or `afterEach` statement is recorded as a hook's line. `variance story compare` lists a region every reading reached first under a different test line on each side, under `first reached under another test line`: the trace of a test that does not wait for the work it started.
