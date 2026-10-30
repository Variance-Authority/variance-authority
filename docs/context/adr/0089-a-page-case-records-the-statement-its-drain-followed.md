# ADR-0089 — a page case records the statement its drain followed

**Status:** accepted
**Date:** 2026-10-11
**Extends:** [ADR-0088](0088-a-case-records-the-test-line-that-reached-each-region.md) (which
seams cut)
**Relates to:** [ADR-0056](0056-a-journey-is-the-places-visited.md) decision 1
(record places),
[spec 0100](../../specs/0100-a-case-ends-where-it-decides.md) (a case ends
where it decides),
[`packages/playwright-test/src/cadence-babel.cts`](../../../packages/playwright-test/src/cadence-babel.cts),
[`packages/playwright-test/src/documents.ts`](../../../packages/playwright-test/src/documents.ts),
[`packages/sense/src/test-selection/runner.ts`](../../../packages/sense/src/test-selection/runner.ts)

## Context

ADR-0088 cuts a case at each statement of its test by recording a log length,
and lists the seams that cut: Vitest, Jest and Rstest. Two drivers record
cases without being one of those seams.

A runner of the user's own goes through `startRecording`, `registerRecording`
and `observeTestFile`. Its probes write to the observed file's buckets in the
test's own realm, exactly as a seam's do, so a log length is a cut there too.

A Playwright spec drives a page. The page's probes write into the page's
realm, which the test reaches only by draining it; there is no log the test
can measure. ADR-0088 admits nothing written on a page, and that stands: the
page keeps one presence bit per region, as ADR-0056 has it. What the test can
do is drain at the moment it would have cut.

## Decision

**A runner of the user's own cuts as a seam does. A Playwright spec cuts by
draining every frame of every page before each statement, and a region is
charged to the statement that ran just before the drain that first found it.**

1. **A custom runner's cut is ADR-0088's.** `startRecording` takes
   `cadence`, carried to every process the run starts. `registerRecording`
   cuts the observed test file; a runner with its own transform calls
   `cutTestFile`. Nothing else differs from a seam.
2. **A Playwright cut is awaited.** `withTestSelection` adds a Babel plugin
   to the configuration's `babelPlugins`. It makes ADR-0088's cut, awaited:
   each statement of an async test or hook body waits while the `context`
   fixture drains every frame of every page. The drain before statement
   *n + 1* charges what it found to statement *n*; the teardown drain charges
   the rest to the last statement. A region already charged keeps its line.
3. **The wait is bounded.** A drain that has not finished in a second lets the
   statement go on, and from there the case's regions are drained without a
   line. A page can hold every evaluation, an open `alert` until the test
   answers it, and the statement that would answer it is the one waiting.
   Teardown waits the same second for the last statement's drain; a page
   still holding it would hold the teardown drain too, so that drain is
   skipped and the case is marked incomplete.
4. **Only the running spec is cut.** A body declared in another file is not
   waited on, and what it reached is charged to the spec statement that called
   it.
5. **It is on by default and can be turned off.** `cadence: false` in the
   recording options of `withTestSelection` or `startRecording` compiles the
   tests as they were and records no lines.

Not admitted, beyond ADR-0088's list: anything a page writes about order, and
a drain on any event other than a statement. The page's own clock decides
when it reaches a region; the line says which statement had just run when the
test looked, and claims only that.

## Consequences

- A region the page reaches asynchronously is charged to the statement that
  was running when it arrived, not to the one that started it. A request a
  `click` sends and the page answers during the next `expect` is the
  `expect`'s. A charge that moves with the outcome is read, not set aside:
  across the runs the record keeps, a region charged to a later statement on
  every failing run is a page that was not ready when the test acted.
- A `test.beforeEach` or `test.afterEach` statement is drained under the
  case's own line, where every other seam flags a hook's line as a hook's. The
  cut does not say which body it is in; a `FIXME` and an `it.todo` hold the
  gap.
- Each statement of a spec costs a round trip to every frame. Over the probed
  Storybook build in `cases/playwright-storybook-case` the lines added 2.4% to
  the record and the duration stayed inside its run-to-run spread; on a
  synthetic suite of 800 statements, a record made of nothing else, they added
  18.9%, with the duration again inside its spread. Spec 0100 holds each under
  twice what it adds to.
- The cut also widens what a case is seen to reach. A document drained before
  the statement that replaced it is read, where with `cadence: false` only the
  teardown drain reads the page and a replaced document is gone by then. So
  turning it off can drop regions from a case's set, not only its lines.
- A drain the test makes would be a step of its own in the report, the trace
  and the inspector, before every statement. It runs as one of Playwright's
  internal calls instead, through its client's `_wrapApiCall`, which Playwright
  does not document; `cadence.chromium.test.ts` fails if a drain shows as a
  step.
- Playwright compiles every file outside `node_modules` it loads as CommonJS,
  including a workspace-linked Sense, so `withTestSelection` adds Sense's
  `dist/` to `build.external`.
- Playwright keys its compile cache on a plugin's path, not its version. After
  an upgrade a spec compiled under the older cut is read from the cache until
  the spec or Playwright changes; `--clear-cache` drops it.
