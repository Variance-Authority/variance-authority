---
id: TASK-22
title: A case names its preconditions
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-02 05:26'
updated_date: '2026-10-02 09:14'
labels: []
dependencies:
  - TASK-24.1
references:
  - docs/context/adr/0046-a-name-may-be-told-what-its-words-mean.md
documentation:
  - docs/specs/0093-a-case-names-its-preconditions.md
  - docs/specs/0094-a-run-writes-one-record.md
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A test declares the state it arranged (mocked network, a flag, the dragon colour) at runtime with `variancePrecondition` from `@variance-authority/sense/precondition`, and the recording carries it per case, so cases can be filtered by it and paired with their twin one axis away. Spec: docs/specs/0093-a-case-names-its-preconditions.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Vitest, Jest, Rstest or Playwright case that calls `variancePrecondition` carries those preconditions, with call sites, on its row in the record's `cases` section, the case index inside `coverage.bin`
- [ ] #2 Hook calls land on the cases the hook ran for; a describe-scoped beforeEach does not reach a sibling describe
- [ ] #3 A narrower scope overrides a wider one; two values in one scope are reported as a contradiction, not resolved
- [ ] #4 `variance covering … --cases --where network=mocked` returns exactly the cases that declared it; an older record answers unmeasured
- [ ] #5 Named preconditions never select or exclude a test
- [ ] #6 With no recording the call is a no-op and the entry imports nothing
- [ ] #7 When `names.axes` declares a name, `variance covering --where` names the one-step twin along the last axis
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Entry @variance-authority/sense/precondition: reads globalThis[Symbol.for('variance-authority.test-selection.precondition')], swallows failures, imports nothing.
2. Recorder installed by the case scope (collectors.scoped): resolves the current case and the level, keeps {name,value,site,level}.
3. Journal: preconditions travel as a field of the case frame owner; a case that only named preconditions still gets a frame.
4. Fold: case-fold merges them per case key; narrower level wins, same-level disagreement kept as a contradiction.
5. Record: optional precondition columns on the case index rows (execution-set-format), read by name so an older record reads as unmeasured; ExecutionTest.preconditions.
6. Runners: Vitest, Jest, Rstest, Playwright level resolution (hooks, describe).
7. CLI covering --cases --where name[=value], unmeasured on an older record; per-case preconditions printed.
8. names.axes twin for ask --test.
9. Tests per AC first; changeset; surface; docs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CLI and closing pass (branch feat/case-preconditions): variance covering --where <name>[=<value>] (repeatable) keeps the declaring cases, refuses a record without a precondition column as unmeasured (RefusalKind 'unmeasured'), counts unlistened cases; text/refs/json print each case's preconditions with sites, contradictions named; names.axes reads an unsaid axis at its base, reports out-of-vocabulary values, and names the twin one step toward the base (packages/cli/src/commands/covering-where.ts). Selection pinned blind to preconditions (case-preconditions-select.test.ts). Open: twin is on covering, AC7 says ask --test; --since text form prints no preconditions (FIXME); Playwright describe/file/beforeAll calls unheard (it.todo); Vitest browser mode not wired.

Owner override applied: variancePrecondition outside a running test throws (describe callback, beforeAll and afterAll, top level, after the case settled). Describe and file scope and prefix matching removed. The installed beforeEach clears held calls per case. Rows carry level so the shard merge resolves like the fold. covering --where twins use names.ts stepTowardBase, shared with structuralParent, and ask runs once. Column size on the repo unit recording (6302 cases): +25296 B silent, about 4 B per case, 5.0 percent of the case index. Merged origin/main at 8653f190, yarn verify green. Open, marked at site: Playwright first-file collection (fixture.ts FIXME), Playwright beforeEach depth (preconditions.ts FIXME), Jest test.concurrent (it.todo), native stitch column (jest-journey-artifact.ts FIXME), native fold (case-fold.test.ts todo, journey_journal.rs FIXME). PR body drafted, not pushed.
<!-- SECTION:NOTES:END -->
