# ADR-0078 — the cache is pruned by its owners, and kept when they cannot answer

**Status:** accepted
**Date:** 2026-09-27
**Relates to:** [ADR-0069](0069-every-answer-has-an-owner.md) (every answer
has an owner), [ADR-0077](0077-the-config-says-where-an-artifact-lives.md)
(the config places the cache),
[`packages/sense/src/test-selection/prune.ts`](../../../packages/sense/src/test-selection/prune.ts),
[`packages/cli/src/commands/prune-cache.ts`](../../../packages/cli/src/commands/prune-cache.ts),
[`packages/store/src/retention.ts`](../../../packages/store/src/retention.ts)

## Context

Only `renders/` had a lifetime: `sweepRenderCache` removes an entry nothing
asked for in 14 days and cuts the rest to 512 MiB, on every `variance run`.
Nothing else in the cache was ever removed, and `docs/cache.md` said so. On the
machine this was written on:

- `test-selection/` held 7,148 repository directories, 772 MB. About 6,986 held
  only `names.bin`: our own unit tests folded fixtures made in `mkdtemp`
  directories, and each fold wrote a layer keyed by a path that was deleted a
  second later.
- 7 of 23 `.work/` layers belonged to worktrees git no longer listed.
- 218 `.run-<pid>-*` directories belonged to processes that had exited. One
  survived a `kill -0` check because its pid had been reused by a system daemon
  nine days later.
- `scans/`, 156 MB, had had no writer since 71fbf70f.
- `suite/<project>/<commit>.bin`, `share/read/<suite>/<commit>/` and `report/`
  gained an entry per commit and lost none.

The request was to clear it on a timely basis without wiping data eagerly,
from `doctor` and automatically, by age and by distance in git.

## Decision

**An entry is removed on the word of the party that knows whether it is still
used. When that party cannot answer, the entry is kept until nothing in it has
been written for 30 days, and `doctor` says it was kept and why.**

| Entry | Removed when | Owner |
|---|---|---|
| a repository layer with `checkout.json` | the checkout it names is not on disk | the file system |
| a `.work/<key>` layer with no marker | `git worktree list` in the primary checkout does not list it, and it is a day unwritten | git |
| `.run-<pid>-*`, `*.<pid>*.tmp`, `*.seed` | the pid is not running, or `ps` says it started after the entry was last written; and the entry is an hour unwritten | the process table |
| a test story | older than 14 days | age |
| `suite/`, `share/read/` per commit | `HEAD` is more than 200 commits past it, or does not contain it and it is 14 days old; the newest per directory stays | git |
| `report/<digest>` | older than 14 days | age |
| `scans/` | always | the code: nothing writes it |

- **The marker.** `checkout.json` (`{checkout, primary}`) is written inside the
  index lock of every fold — Vitest, Rstest, Jest, the journal writer, the
  published writer and Playwright Test — so its mtime is the layer's last use.
  `cacheLayers()` does not write it, because read-only commands call it.
- **The recording is never aged out** while its checkout exists. It is one
  file each run rewrites, so it does not grow with history, and without it the
  next `test:since` runs the whole suite. That is the eager wipe the request
  ruled out.
- **When.** At the end of a fold, after the lock is released, and at the end of
  `variance run` beside the render sweep — at most once a day, gated by the
  mtime of `<cache>/test-selection/.pruned` and `<cache>/.pruned`, so a
  7,000-directory `readdir` is not on every test run. It never throws, and it
  prints one line only when it removed something:
  `cache: freed 17.8 MiB in <root>: 218 runs whose processes are gone, 7 worktrees git no longer lists`.
- **Doctor** reads both plans with sizes and prints what the next prune
  removes, by rule, and what it keeps for want of an answer. `--prune` applies
  both now and ignores the stamp. A cache never changes doctor's exit code.
- **The leak is stopped at its source.** `vitest.config.mts` gives the workers
  `XDG_CACHE_HOME` in a per-run temporary directory. The main process folds the
  recording and does not read `test.env`, so this repository's own recording
  stays where it was. A full `yarn test` after the change left the count of
  repository directories at 7,148.

The thresholds are constants beside `RENDER_CACHE_*`, not configuration:

- **1 hour** for a dead run: a cache restored from another machine carries pids
  that mean nothing here. It costs an hour of a crashed run's scratch.
- **14 days** for stories and reports, matching renders. A story is read by
  someone looking at one case now; nothing selects on it or compares it.
- **30 days** for anything nobody can answer for. A legacy layer with no
  marker, a commit this clone has never fetched and a git that fails all land
  here. It costs a month of the leaked layers, which the marker ends for new
  ones.
- **200 commits** behind `HEAD`: a question about a commit that far back is
  rare, and `share` fetches it again when one is asked.

## Alternatives

- **A size ceiling, like renders.** A ceiling removes the largest or oldest
  entry whether or not it is used, and the largest is the recording. Renders
  can take one because a lost render costs one paint; a lost recording costs a
  whole-suite run.
- **Configuration knobs for each threshold.** Each knob is a second owner of an
  answer the process table or git already has. Nobody could pick a better
  number than the one that follows from the owner.
- **Doctor only, no automatic prune.** The cache grows where nobody looks,
  which is the reason renders were given a sweep. A user who never runs doctor
  would keep the 772 MB.
- **Age alone, everywhere.** A worktree deleted this morning would keep its
  layer for a month, and a recording idle for a month on a live checkout would
  be deleted.
- **Compaction or a Rust reader for stories.** One story is bounded by one
  test and by `TAPE_LIMIT`, and stories are recorded for a focused
  investigation, never a suite. The one cost that grew with count was
  `listStories` decoding every body to count its visits; it now reads the
  header.

## Open

- Under watch mode a settled run returns early on every rerun, so a rerun's
  files are not folded and its `.run-*` stays until the process exits. The
  `FIXME` is at the `settled` check in `selection-fold.ts`.
