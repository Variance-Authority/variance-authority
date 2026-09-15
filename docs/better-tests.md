# Make a suite faster, stabler, smarter and cheaper

A suite gets slower, flakier and more expensive every month somebody works on
it, and the standard answers pay for one of those with another. Shard it and buy
the time back in machines. Retry it and trade a false alarm for a missed
regression at a rate nobody measures. Rebuild the world between tests and pay on
every test to prevent a leak in a few.

None of those is wrong. Each is what you do when the run left nothing behind to
reason from. A run knows which regions it entered, which elements it addressed,
and what had already happened before its first line, and teardown is normally the
end of all of it. Keep it, and the same four questions have measured answers
rather than policies — which is the difference between a build tool predicting
what a change could reach and a record saying what a test did.

Rendered comparison is the loudest use of that evidence, and it is one use. None
of the four below needs a browser: the Vitest 2 and Jest 30 seams instrument,
collect and persist around the transformer the project already uses, and Eyes
watches React Testing Library's `screen` from a setup file.

## Faster: run what the change reached

A one-line edit costs the whole suite because nothing in the repository knows
which tests that line is under. Something does know: the last run.

`withTestSelection` wraps the runner configuration once, and every run from then
on records which test file entered which region. The next run reads that back
and asks which test files the diff reaches.

This repository does it to itself. `yarn test` instruments what it loads, and
`yarn test:since` runs the test files the edit reached — `tools/test-since.mjs`
over `@variance-authority/sense/test-selection`, on the published entry point
rather than a private path. Before it existed, three hundred test files ran to
find out whether a comment was spelled right.

[Run relevant work](run-relevant-work.md) is the decision;
[selection](selecting.md) owns the rules that widen it, and
[distance](distance.md) puts the nearest selected test first.

## Cheaper: stop paying for imports nothing exercises

A test that imports a module runs that module's top level whether or not it ever
calls into it, and the graph moves that test on every change to it.
`variance distill` reads an entered module region by region, so a module whose
only crossing is its own load is reported as exactly that, with the declarations
nothing reached and the substitution to try.

Writing that substitution pays twice: the run stops evaluating the module, and
the scan — which reads `vi.mock`, `jest.mock` and `sb.mock` off test, story and
setup files — stops drawing the edge, so the next selection is narrower too.

[Make one test cost less](optimize-a-test.md) is that loop.

## Stabler: name the writer instead of rebuilding the world

Subject B fails only when A ran first, and the usual answer is to rebuild the
world between them — paying on every test forever to prevent a leak on a few.

A unit suite has that leak one level down. A client built at a module's top
level, a registry a decorator fills, a clock read into a constant: the work
happened before the first test of every file that imported the module, and
whether it had happened when a given test looked depends on which file loaded it
first. The Vitest and Jest seams snapshot every counter before each file's first
test, so a region already entered by then is recorded as **loaded** by that file
rather than as something the file exercised.

[Test order and shared state](flakiness.md#test-order-and-shared-state) is the
whole taxonomy, including what a probe can and cannot attribute.

## Smarter: keep what the run knew

An assertion is a question written before the run, and its answer is one bit.
The process that produced that bit also knew which elements were addressed,
which components rendered, which instance scheduled each render, and which
branch a module took — and teardown is the end of all of it.

The test does not change to keep it. Same queries, same expectations, same pass
and same fail; what changes is what is left behind to ask questions of.
[Ask a question the test did not](observability.md) is the record,
[Eyes](eyes.md) is the addressed surface, and [journeys](journeys.md) follow the
regions an execution entered across processes.

## What each reading asks for

| Reading | Seam | Also needs |
| --- | --- | --- |
| Selection and distance | `withTestSelection` in the Vitest or Jest config | a recorded run to select from |
| Region-level distillation | the same instrumentation | one test's execution index, and `variance distill` |
| Order-dependent module state | the same instrumentation | nothing further |
| Addressed elements | `watch(screen)` from a setup file | React Testing Library |

The first three come from one wrap of the runner configuration. Nothing here
asks the suite to adopt a baseline, a reporter, a `test`, or an `expect`.

---

**Further:** [`packages/sense`](../packages/sense) for what the scan reads and
where the seams stop · [`packages/eyes`](../packages/eyes) for the attention
journal · [`packages/distill`](../packages/distill) for the analyzer ·
[`performance.md`](performance.md) for what a run costs.
