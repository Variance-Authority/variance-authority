---
'@variance-authority/cli': minor
'@variance-authority/playwright-test': minor
'@variance-authority/sense': minor
---

A case names its preconditions

`variancePrecondition(name, value?)`, from `@variance-authority/sense/precondition`,
says what state a case arranged: `variancePrecondition('network', 'mocked')`,
or several at once as `{ flag: 'ff-on' }`. Said in a case body it is the case's;
said in a `beforeEach`, a `describe` or at a file's top level it reaches the
cases that scope ran for and no sibling. A narrower scope overrides a wider one,
and two values said in one scope are kept as a contradiction. Each lands on the
case's row in `coverage.bin` with the `file:line` of the call. Vitest, Jest and
Rstest listen under `withTestSelection` and their seams; Playwright hears a case
body and its `beforeEach`. Without a recording the call returns, and the entry
imports nothing. A precondition never selects or excludes a test.

`ExecutionTest.preconditions` holds the row: empty for a case that said nothing,
absent for a record nobody listened to. `PreconditionValue` types a value.
`listenForPreconditions`, `PreconditionListener` and `PreconditionStanding`,
from `@variance-authority/sense/journal`, let a runner seam listen, and
`createExecutionRecorder` takes the standing case as a third argument.

`variance covering --where <name>[=<value>]` keeps the cases that said it, and
repeats to require several. A record made before cases said anything is refused
as unmeasured. Every case line prints what it said and where, and where
`names.axes` declares the name, the case one step toward the axis's base is
named as its twin.
