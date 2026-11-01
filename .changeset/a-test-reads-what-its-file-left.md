---
'@variance-authority/isolator': minor
'@variance-authority/ioc': minor
---

A test reads what its file left before it, as the file would alone

The isolator started every test on the values its modules were loaded with, so
what a `beforeAll` wrote, and what a module the test file imported registered
as it loaded, was gone by the first test. Under Vitest's `isolate: false`, a
file was collected against whatever the files before it left. Now a file
starts on the values its modules were loaded with, and each test runs in a
session of its own that starts from what the file wrote while it was collected
and in its `beforeAll` and `afterAll` hooks. What the test, its `beforeEach` and
its `afterEach` write is dropped when it ends.

Hand the driver the runner's `afterEach` too: `configureResetHandler(beforeEach,
afterEach)`. Without it no test ends, and what a nested `describe`'s
`beforeAll` writes lands in the test before it. ioc's driver gains that second
argument and `registerTestScope(scope)`, which the isolator registers in place
of a reset handler.
