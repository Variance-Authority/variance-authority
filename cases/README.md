# Cases

A case exercises Variance against a host, runner, or comparison implementation
that owns part of the workflow. Unlike [`examples/`](../examples), cases do not
let the project define every input and expected output for itself.

## Choose a case

| If you need to see | Start with | Showcase |
| --- | --- | --- |
| A real screenshot incumbent challenged by semantic inspection | [`incumbent-case`](incumbent-case) | Replacement comparison, migration, render-only inspection, and locale layout |
| A real external UI build driven through the durable workflow | [`storybook-case`](storybook-case) | Storybook collection, readiness, Suspense handling, source attribution, and CLI baselines |
| An existing Playwright Test suite adopting Variance additively | [`playwright-additive-case`](playwright-additive-case) | Native `test` and `expect`, an unapproved first run, explicit acceptance, and unchanged re-observation |
| Vanilla Vitest/jsdom capture followed by a later browser process | [`unit-capture-case`](unit-capture-case) | Browserless resource-closed capture, archive handoff, CLI rendering, and baseline reuse |
| A test waiting on the decision an application made rather than on what it drew | [`event-announcement-case`](event-announcement-case) | Announcements from a page and from a service, concurrent executions kept apart, and what a wait that does not settle says |
| One execution followed from the browser into a service that serves many at once | [`journey-tracing-case`](journey-tracing-case) | A shared execution id, announcements and coverage on one medium, and a next run narrowed to the spec that entered the branch |

Each case README owns its prerequisites, commands, expected evidence, and the
boundary it does not test. Run the narrowest case that matches the integration
being evaluated.

## Case contracts

- The external side is real: its own runner, artifacts, and failure messages.
- The expected answer is declared before the observation, so a disagreement is
  a finding rather than a score to adjust.
- Missing prerequisites skip loudly with the command that makes the case run.
- Generated or prebuilt inputs refuse stale source bytes instead of reporting an
  agreement against an old implementation.

`tools/skips.check.ts` enforces the visible-skip contract. The case-specific
tests own stale-artifact checks where a workflow consumes prebuilt output.

## What cases establish

The incumbent case covers the comparison and inspection claims listed in its
README. The Storybook case covers the built-Storybook collection and durable CLI
workflow. The Playwright and unit-capture cases cover adopter ownership and the
two materialization models introduced by those packages. The announcement and
journey-tracing cases cover the wait instrument and the medium it shares with
coverage reporting, including a service's execution attributed to the spec that
drove it.

These cases do not establish managed review, browser-fleet, service-level, or
cross-repository product claims. Those boundaries belong in
[`docs/gates.md`](../docs/gates.md) and
[`docs/comparison.md`](../docs/comparison.md); measurement definitions belong in
[`docs/metrics.md`](../docs/metrics.md).
