---
'@variance-authority/sense': minor
'@variance-authority/playwright-test': minor
---

A story recorded under a document says what each test line did to the page

With `VARIANCE_AUTHORITY_STORY=1` and a `document`, as under jsdom, in the browser modes of Vitest and Rstest, or in the page a Playwright spec drives, the story watches the page and writes one note on each test line that changed it: `page +1 −0 nodes, 2 attributes, 0 text`, counted since the line opened. A line that changed nothing has no note, so a `findBy` or `waitFor` that passed on such a line waited on no change to the markup, unless it waited on a property such as an input's `value`. React commits stay with Eyes, which already writes each one under its step. A hook's line and the end of the test close the watch until the next test line, so what hooks and a testing library's cleanup change has no note. A run without a document, and any run that records no story, starts no watch. Under Playwright, a document a statement loads is counted from the statement after it.
