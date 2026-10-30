---
'@variance-authority/playwright-test': patch
---

A page in a context the spec makes itself writes its story

A Playwright case that opens its own context with `browser.newContext()` or `browser.newPage()` now records what its pages ran, and writes it to the case's story under the test line each statement is on, as a page in the runner's `context` does. A context the spec closes is drained as it closes, and one it leaves open is drained when the test ends.

The same pages now enter the coverage record too, so a change to code only such a page ran selects the case, and a document replaced before it was read marks the case incomplete, as one in the runner's `context` does.
