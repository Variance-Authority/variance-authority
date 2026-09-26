# ADR-0076 — a suite is declared ahead of time, and records alone

**Status:** accepted
**Date:** 2026-09-26
**Relates to:** [ADR-0069](0069-every-answer-has-an-owner.md) (the configuration
owns what a setting means),
[spec 0062](../../specs/0062-a-suite-says-which-files-reach-it.md) (a suite's
declared nature decides which edges reach it),
[`packages/sense/src/test-selection/cache-layers.ts`](../../../packages/sense/src/test-selection/cache-layers.ts),
[`packages/sense/src/test-selection/index.ts`](../../../packages/sense/src/test-selection/index.ts)

## Context

Every seam writes into one file, `<layer>/coverage.bin`, unless its caller
passes `coverageFile`. A repository that runs Jest for units, Playwright for
end-to-end and a Storybook suite for pictures holds all three in that one
record, and three things go wrong:

- `layerTestCoverage` discards the whole previous snapshot when the
  instrumentation modes differ, so a Playwright run can wipe the Jest record.
- A module two builds load is re-cut by whichever ran last, which coarsens the
  other build's regions. A record is only as precise as the build that cut it.
- One recorded commit stands for suites that ran at different commits, and the
  runs log beside it counts their runs as one.

A test file's name cannot separate them either. An rspack experiment runs the
same test files as the unit suite, under a different transform.

The record also cannot say what kind of test ran a line. A reviewer asks
whether a changed line is pinned by a unit test or only by an end-to-end
journey, and whether payment code ran under the visual suite, which should
render it from fixtures. Neither question can be answered by a record that
does not know which suite wrote each row.

## Decision

**A suite is named and given a kind in the root `variance.config.json`, before
anything runs, and each suite records into its own directory.**

```json
{
  "suites": {
    "unit": { "kind": "unit" },
    "stories": { "kind": "visual" },
    "checkout": { "kind": "e2e" }
  }
}
```

- **The kinds are a closed list:** `unit`, `integration`, `e2e`, `visual`. A
  reader that groups by kind, or a rule that says what a kind may reach, needs
  to know what each one means. A free word would mean what each project thought
  it meant.
- **The key is root-only**, like `cacheRoot`, because every seam reads the
  root file and no other.
- **Each declared suite records under `<layer>/suites/<name>/`**: its coverage
  record, its case index, its runs log, and the journeys it folds. The source
  index and the name table stay shared at the top of the layer, because they
  describe the checkout and not a run. Worktree layering is unchanged: a
  worktree seeds each suite from the same path under the base.
- **A seam names its suite** with a `suite` option. A name the configuration
  does not declare fails before the run starts. Once any suite is declared, a
  seam that names none fails too: it would write a record nobody declared.
- **A repository that declares no suites keeps one record** at
  `<layer>/coverage.bin`. That record is one suite with no name and no kind,
  and readers report it that way.
- **A caller that passes `coverageFile` owns that file.** It is not a layer of
  anything and is not checked against the declaration, the same rule
  `seedTestCoverage` already follows.
- **Readers follow the question.**
  - A reader scoped to one runner reads one suite: the one named with
    `--suite`, or the only one declared. With more than one declared and none
    named, it refuses and lists them. This covers a skip list, `variance
    select` and `variance run --since`.
  - A repository question reads every declared suite and groups the answer by
    kind. This covers which tests cover this line, and `variance review`.
  - A declared suite with no record is reported as unrecorded, never as a
    suite that covers nothing.

## What this forecloses

- **Discovering suites from what ran.** A suite is not inferred from the seam,
  the runner or the record directory. A record directory no declaration names
  is not read.
- **Inferring the kind.** A Playwright suite may be `e2e` or `visual`, and a
  Vitest browser suite may be `unit` or `visual`. The runner does not decide.
- **One record for several suites**, and `coverageFile` as the way to keep
  suites apart.
- **A fallback to the shared record** once suites are declared. The old file
  is not read as any suite's.

## Cost

- A repository with more than one suite writes the declaration, and names the
  suite in each seam's options.
- Declaring suites starts every suite cold. The shared record is not split
  into the suites that wrote it, because it never recorded which suite wrote
  which row.
- A reader that answered from one file now opens one per suite.
- A new kind is a code change, not a configuration change.
