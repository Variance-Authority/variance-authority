---
'@variance-authority/playwright-test': patch
---

A modifier's callback is not Arrange

Under Playwright, a `variancePrecondition` call made in the callback of
`test.skip`, `test.fixme`, `test.fail` or `test.slow` landed on a case as if
the case body had said it: on each case for a callback that reads a test
fixture such as `page`, and on the case Playwright was about to run for one
that reads only worker fixtures. It now throws with its call site, as a call in
a `beforeAll` does, because the callback decides whether and how the case runs
and arranges nothing for it. Move the call into the case body or a
`beforeEach`. A test fixture that says a precondition as it is set up still
lands on its case, whichever callback asked for it first.
