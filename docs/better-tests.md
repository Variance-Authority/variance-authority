# Improve your test suite

Variance Authority records which code your tests execute and which page elements
they query or interact with. You can use that record to choose tests after an
edit, investigate flaky results, and find dependencies that make a test costly.

The Vitest 2 and Jest 30 integrations work with your existing test configuration
and assertions. Browser tests also benefit from reusing the browser and page
across a run.

## What do you want to improve?

| Problem | What you can do | Start here |
| --- | --- | --- |
| Small edits trigger most of the suite | Select tests using the code they executed in a previous run | [Run relevant tests](run-relevant-work.md) |
| Relevant tests still take too long to give feedback | Run tests closest to the changed module first | [Run nearby tests](distance.md) |
| One test loads far more code than it exercises | Find imported modules to investigate, then verify a smaller setup | [Reduce a test's cost](optimize-a-test.md) |
| A failure is hard to explain after CI finishes | Inspect recorded elements, components, and executed source | [Inspect a completed run](observability.md) |
| Visual results depend on timing or test order | Compare repeated captures and a capture in a clean environment | [Investigate flakiness](flakiness.md) |

## Run fewer tests after an edit

Suppose you change a function in a shared module. An import graph can tell you
which tests depend on that module. A recorded run can also tell you which tests
executed the changed part of it.

Add `withTestSelection` to your runner configuration and record a run. Selection
uses that record with the next source diff to choose test files. When a changed
file or an incomplete record prevents a safe selection, the run widens or the
selection is refused. A skipped test has no new result.

Start with the [Vitest setup](../packages/sense#select-vitest-files-from-a-change)
or [Jest setup](../packages/sense#select-jest-files-from-a-change).
[Run relevant tests](run-relevant-work.md) explains how selection and test order
fit together.

## Find dependencies a test may not need

A checkout test might load a chart module without ever rendering a chart.
`variance distill` identifies modules like this and lists the declarations the
test did not execute.

That gives you a specific change to investigate: replace a dependency with a
mock, rerun the test, and check that it still tests the intended behavior. A
module may perform necessary setup when imported, so the report alone cannot
tell you that removing it is safe.

An explicit mock can also narrow future test selections, because the source
scanner recognizes `vi.mock`, `jest.mock`, and `sb.mock`.
[Reduce a test's cost](optimize-a-test.md) walks through that process.

## Keep enough information to investigate a failure

An assertion failure tells you what expectation failed. Eyes, the interaction
recorder, retains the elements a test queried or interacted with and their
component and source locations when available. Source instrumentation records
which functions and branches executed. You can inspect these after the test
process exits.

For React Testing Library, `watch(screen)` attaches in a setup file. Recording
React updates also requires a commit hook installed before `react-dom` loads;
`watch` attaches to an existing hook.
See [Inspect a completed run](observability.md) for the available information
and the [Eyes setup](../packages/eyes#watch-rtl-screen-queries).

## Spend less time setting up browser captures

Variance Authority's browser session keeps a browser and page open across
subjects: the stories or page regions being compared. The Storybook collector
switches stories through Storybook's API. This avoids paying for a new browser
and navigation for every capture.

In a measurement over 48 renders, capture took about **7.5 ms** with an open page
and **205 ms** when it included launching a browser. These are capture timings
from one machine and one Chromium, not a prediction for your suite. See
[the measurement and reproduction commands](context/journal/0007-persistent-harness-and-p4.md).

Reusing a page makes shared state worth checking. When a captured subject
changes, the diagnostic passes check whether it changes again in the same page
(`unstable`) or differs in a clean environment (`order-dependent`). They retain
the finding rather than clearing it as a successful retry. The collector must
support a clean environment for the second check.

[Flakiness](flakiness.md) explains the checks, their limits, and how to investigate
the component they identify. [Start with Storybook](start-storybook.md) if you
want to apply browser reuse to a story suite.
