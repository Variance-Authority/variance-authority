---
id: TASK-20
title: Gate an optimization loop on commit counts
status: To Do
assignee: []
created_date: '2026-09-15'
labels: []
dependencies:
  - TASK-1.3
  - TASK-19
references:
  - packages/react/src/commits.ts
  - packages/scenario/src/assessment.ts
  - vitest.measure.config.ts
  - docs/journeys.md
  - docs/scenarios.md
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An optimization loop runs: capture, refactor, capture, compare, go or no-go. The
shape is makefaster's. The gate is not, and must not be.

makefaster keeps a change when the second run is faster than the first. This
repository has already recorded what that costs. `vitest.measure.config.ts`
documents the session cost test falling from about two thirds to about half
under instrumentation, at which point it began to fail for a reason unrelated to
the code it exists to hold. A ratio of two timed runs gates on the machine. An
optimization loop is exactly the place that lesson gets forgotten, because
timing is what an optimization *feels* like it is about.

It does not have to be. `packages/react/src/commits.ts` taps every React commit
and names the components that rendered in it; its own example reads
`Clock ×31, PriceTicker ×31`. `×31 → ×2` is a real win, it is deterministic, and
it reads the same under load, in CI, and on another architecture. **The count is
the gate.**

### Journeys are the safety half, never the win half

`docs/journeys.md` is explicit that a journey is a *set* of regions — not how
deep, not in what order, **not how many times**. A refactor that turns three
hundred calls into three has an identical journey. A loop that gates on journey
diff will therefore report no change on its best wins, and whoever wired it will
conclude the loop works. Journeys answer the other question: whether the refactor
changed which code runs at all, and when it did, the parting has a name and
lines.

So the readings divide:

| reading | instrument | role |
| --- | --- | --- |
| commits per component | `tapCommits` | the measure |
| regions entered | `sense/journey` | veto — the shape changed |
| Acts and their effects | `@variance-authority/scenario` | veto — behaviour changed |
| raster | the existing comparison | veto — output changed |

Go is: commits down, raster identical, scenario path identical, journey diff a
subset of what the refactor intended to stop entering. Three of the four
comparisons are implemented. The verdict is not, and is absent by design —
`docs/scenarios.md` states that scenario assessment writes no baseline,
approval, history row, changelog, or exit code. Folding four readings into one
go or no-go is the new work, and it is small.

### Two things that corrupt the measure

Memoization makes a subject's commit count depend on which subject rendered
before it, and adding caching is precisely what an optimization loop does. A
loop that does not pin subject order across the two captures reports wins that
are partly the neighbour's.

And the loop must not revert through git. Work here lands on `main` while the
checkout is in use, the standing rule is that nothing touches the index, and an
automated keep-or-revert will eat uncommitted work. The loop either runs in a
worktree or reports the verdict and leaves the revert to its caller.

`tapCommits` has no consumer today and its install-before-`react-dom`
requirement is unresolved (TASK-1.3), which this loop turns from an open
question into a dependency.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Capture per-component commit counts for a subject before and after a change and fold the pair into one verdict with an exit code
- [ ] #2 Carry journey parting, scenario divergence, and raster comparison as vetoes on that verdict, never as the measure, and cover the case where the count improves and a veto fires
- [ ] #3 Pin subject order across both captures and prove the memoized case, where an unpinned order reports a win the change did not make
- [ ] #4 Confirm `tapCommits` survives a built Storybook, where minified component names would sink the count before any other reading is reached
- [ ] #5 Leave the index untouched: run in a worktree or report without reverting, and cover that no git mutation occurs on either verdict
- [ ] #6 Stream the loop's readings to vantage so an agent watches counts move rather than waiting for a report, reusing the channel TASK-19 opens
- [ ] #7 Keep every gating quantity a count or a within-run share, with no ratio of two timed runs anywhere in the verdict
<!-- AC:END -->
