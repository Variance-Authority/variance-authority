---
'@variance-authority/playwright-test': minor
'@variance-authority/sense': minor
---

A snapshot names the case it was taken in, and what that case had arranged

A snapshot taken with the Playwright `variance` fixture now carries `case`: the
spec file, the declaration path and `testInfo.testId` — the case id the record
already keeps — and the preconditions the case had said with
`variancePrecondition` by the time the snapshot was taken, each with its call
site. A call after the snapshot lands on the case's row and not on the
snapshot. The same line closes a failing `toBeUnchanged` message and is added as
a `variance` annotation that Playwright's report shows under the test, passing
or not. Without `varianceExecution` nothing listens: no annotation is added,
and a failing message reads *preconditions unmeasured* rather than *nothing
arranged*.

`PreconditionListener.held(key)` returns what a running case has said so far,
resolved as its row would be, without taking it from the row.
`@variance-authority/sense/journal` exports `CasePrecondition` and
`preconditionText`, the one rendering `variance covering` and the snapshot
share: `flag=ff-on (spec.ts:9)`, a bare `true` as its name, a contradiction
with both values. `ExecutionRecorder.arranged(owner, test)` reads a case's view
from a Playwright worker's recorder.
