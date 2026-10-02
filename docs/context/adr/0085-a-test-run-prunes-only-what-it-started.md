# ADR-0085 — a test run prunes only what it started

**Status:** accepted
**Date:** 2026-10-03
**Supersedes, for when only:** [ADR-0078](0078-the-cache-is-pruned-by-its-owners.md)'s
*When* bullet, and doctor's `--prune`. What is removed, on whose word, and the
thresholds stand.
**Relates to:** [ADR-0069](0069-every-answer-has-an-owner.md) (every answer
has an owner),
[`packages/sense/src/test-selection/selection-fold.ts`](../../../packages/sense/src/test-selection/selection-fold.ts),
[`packages/cli/src/commands/prune-cache.ts`](../../../packages/cli/src/commands/prune-cache.ts)

## Context

ADR-0078 pruned the cache at the end of every fold — Vitest, Rstest, Jest and
Playwright Test — at most once a day, gated by a stamp. A fold is the end of a
test run, and the cache it pruned is shared by every run on the machine, every
worktree and every suite. So finishing a test run did housekeeping for runs it
did not start, on the day the stamp happened to fall due.

That is a hidden side effect, and it was visible in two places:

- Which run removed another run's scratch depended on which run finished first
  after the stamp expired. A test that left an entry for a later assertion saw
  it gone on one day in each, and only when no other run had pruned that day.
- This repository's own recording credited the prune's reads to whichever test
  file's fold crossed the stamp, so the record of what a file reached changed
  with scheduling rather than with code.

The prune had two owners for one answer: the run that wrote an entry, and the
first run of the day to finish.

## Decision

**A fold removes its own run directories and nothing else. Pruning the rest is
a command somebody runs.**

- **Folds.** `foldRun`, the Jest reporter and the Playwright Test reporter no
  longer call `pruneWhenDue`. Each removes the run, case and finished-file
  directories it made, as before.
- **`variance prune`.** Runs both prunes now, whatever the stamps say, and
  prints the lines `variance run` prints, or `cache: nothing to prune`. It
  reads no project configuration, so it runs in a repository that only runs
  test suites: the cache is the one `VARIANCE_AUTHORITY_CACHE` or
  `node_modules/.cache/variance-authority` names. It is `pruneNow` and
  `prunedLines`, the two calls `doctor --prune` made.
- **`variance run`** keeps its daily prune at its end, beside the render
  sweep. A `variance run` is a command the user started for the cache's sake,
  so the prune is part of what it was asked to do.
- **Doctor** reports what the next prune removes and takes no `--prune`. The
  flag is removed, not aliased: one command changes the cache, the other reads
  it.

## Alternatives

- **Keep the fold prune, but stop it reading through the recorder.** The
  record would stop moving, and the run that removes another run's scratch
  would still be whichever finished first. The side effect stays; only its
  witness goes.
- **Prune from this repository's Vitest config.** The config would import the
  CLI's build to reach `pruneNow`, and claim at config level an answer the
  runner seam owns. It fixes this repository and no user's.
- **Keep `doctor --prune` as an alias for `variance prune`.** Two spellings of
  one action, and a read-only command with one flag that writes.

## Consequences

A machine that only runs test suites, and never `variance run`, is pruned
only when someone runs `variance prune`: in a CI cleanup step, a scheduled job,
or by hand. Until then the dead runs, gone worktrees and old commits ADR-0078
lists accumulate there as they did before ADR-0078. `variance doctor` says how
much.
