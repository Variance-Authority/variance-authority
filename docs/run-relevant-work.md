# Run relevant tests after a change

Variance Authority uses your source diff and recorded test execution to choose
which tests to run. It can then order those tests by how directly they depend
on the changed code, so you get focused feedback early.

Use this when a small edit triggers a large suite and you want to understand
why each selected test needs to run.

## Choose tests, then choose their order

Suppose you edit a shared formatter. Three pieces of information help:

| Information | What it tells you | Guide |
| --- | --- | --- |
| Imports and declarations | Which parts of the project could depend on the formatter | [Source dependencies](source.md) |
| Recorded execution | Which tests executed the changed code in a previous run | [Test selection](selecting.md) |
| Import distance | Which selected tests have the fewest modules between them and the edit | [Run nearby tests first](distance.md) |

Selection chooses the test files. Distance orders that selection; it does not
remove tests from it. A direct test of the formatter may give you a useful
failure before a page test that reaches it through several components.

## Set up recorded selection

The Vitest 2 and Jest 30 integrations wrap your existing configuration with
`withTestSelection`. Run the suite to record what each test file executes, then
use that record to select tests for a later change.

Follow the [Vitest setup](../packages/sense#select-vitest-files-from-a-change)
or [Jest setup](../packages/sense#select-jest-files-from-a-change) for the
configuration and selection API. [Test selection](selecting.md) also covers
`--since` for rendered subjects and the inputs supplied by `nx` or `turbo`.

Once selection works, use [distance ranges](distance.md) to run nearby tests
during editing and the remaining tests before verification.

## When more tests must run

Selection depends on having enough information to exclude a test. A changed
file missing from the record, an unresolved dependency, or incompatible recorded
data can widen the run or prevent selection. The result reports the reason.

A skipped test has no new observation or verdict. Passing the selected tests
supports a narrower claim than passing the full suite; keep the project's full
verification gate.

For the exact fallback rules, see [Test selection](selecting.md). For problems
resolving an import or mapping a source change, see [Source dependencies](source.md).
