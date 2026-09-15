# Inspect a test after it finishes

Variance Authority retains details that help explain a test after the process
has exited: the elements it queried or interacted with, the components involved,
and the source code that executed.

For example, a checkout test may click a button that immediately disappears.
The retained record can still identify that button's owning component and source
location when React exposes them. You can investigate the completed run without
reproducing that moment in a debugger.

## What you can inspect

| Question | Recorded information | Guide |
| --- | --- | --- |
| Which element did the test query or interact with? | Selectors, events, and target details | [Eyes](eyes.md) |
| Which component owned that element? | Component paths and source locations, when available | [Eyes](eyes.md) |
| Which React component initiated an update? | Update initiators, separately from components that rendered | [React update records](eyes.md) |
| Which functions and branches executed? | Instrumented source regions associated with the execution | [Execution journeys](journeys.md) |
| What happened while a run was still active? | Live observations | [Watch a run](vantage.md) |

These records supplement the test's assertions. They do not change its pass or
fail result.

## Set up recording before the run

Eyes records DOM interactions. Its React Testing Library integration attaches
through `watch(screen)` in a setup file. Source execution is recorded separately
by the Vitest, Jest, or browser instrumentation. Follow [Eyes](eyes.md) and
[execution journeys](journeys.md) for the appropriate integration.

React update recording requires a commit hook installed before `react-dom`
loads. `watch` attaches to that hook; it does not install one. If the hook is
unavailable, the recorder reports that it cannot provide that information. It does not
report an empty update list.

Component attribution is copied while the element is still available, before
a handler can remove it. The saved record contains values rather than live DOM
or React objects, so it remains readable after unmounting and teardown.

## Follow execution into a service

When a test calls an instrumented service, its execution record can include the
service's source too. The driver assigns an execution ID, carries it on browser
requests, and collects the service's reports under that ID.

This lets the report distinguish two tests using the same service concurrently.
Joining by a test title or timestamp would leave that distinction ambiguous.
The service must be instrumented and configured to report; ordinary network
traffic alone does not reveal which branches it executed.

See [execution journeys](journeys.md) for setup and the cross-process contract.

## Understand what the record establishes

**Recorded execution identifies code that ran.** It does not establish that an
assertion checked that code, or that the code is safe to mock. Use
[Distill](distill.md) to find candidates, then verify any substitution by
rerunning the test.

**An update initiator identifies a component instance.** It does not identify
the exact callback, timer, or source statement that scheduled the update.

**Missing information stays missing.** An empty list means recording completed
and found no entries. Unavailable or incomplete information is reported
separately. If an expected service reports nothing, the run cannot use that
silence to exclude tests: the service might have executed code the recorder
missed.

Start with [Eyes](eyes.md) for a DOM interaction, or
[execution journeys](journeys.md) for a source-level question.
