---
'@variance-authority/playwright-test': minor
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

A case in a page writes a story, with the test line each statement ran at

With `VARIANCE_AUTHORITY_STORY=1`, a Playwright case, and a Vitest or Rstest case in browser mode, now write a test story, as a Node case does: the code the page ran, in order, with each statement of the test opening what the page did next with its line. What a Playwright spec prints in its own process is said there too, under the statement that printed it. A document the case replaces by navigating keeps what it ran, in the story and in the record: the next document of the same origin in its frame hands it on, under the statement that navigated, and the spec is no longer recorded as incomplete for it. A Node story carries its test lines the same way. `variance story` shows each one as `test line N`, or `hook line N` for a `beforeEach` or `afterEach` statement, at the step where it began. A test body registered through `test.extend` or under an imported alias is cut too.
