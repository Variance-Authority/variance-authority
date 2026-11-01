---
'@variance-authority/isolator': minor
'@variance-authority/ioc': minor
---

A test reads what its file left before it

The isolator started every test on the values its modules were loaded with, so
what a `beforeAll` wrote was gone by the first test. Under Vitest's `isolate: false`, a
file was collected against whatever the files before it left. Now a file
starts on the values its modules were loaded with, and each test runs in a
session of its own that starts from what the file wrote while it was collected
and in its `beforeAll` and `afterAll` hooks. What the test, its `beforeEach` and
its `afterEach` write is dropped when it ends.

A concurrent test starts from the same file session, through
`isolateConcurrentTests` and `isolateConcurrentEach`.

`configureResetHandler` now takes the runner's `afterEach` as a required second
argument: `configureResetHandler(beforeEach, afterEach)`. A driver that never
hears a test end would leave what a nested `describe`'s `beforeAll` writes in
the test before it, so a call without it throws. ioc also gains
`registerTestScope(scope)`, which the isolator registers in place of a reset
handler.
