# ADR-0084 — every base is main's record, and the primary checkout is the offline fallback

**Status:** proposed
**Date:** 2026-09-30
**Amends:** [ADR-0077](0077-the-config-says-where-an-artifact-lives.md) (the
config says where an artifact lives), in three places named below; ADR-0077 is
left as written
**Relates to:** [ADR-0069](0069-every-answer-has-an-owner.md) (fall back, never
fake), [ADR-0076](0076-a-suite-is-declared-and-records-alone.md),
[ADR-0078](0078-the-cache-is-pruned-by-its-owners.md),
[spec 0074](../../specs/0074-what-ci-derived-is-reachable-from-a-checkout.md),
[`suite-base.ts`](../../../packages/cli/src/commands/suite-base.ts),
[`mainline-base.ts`](../../../packages/cli/src/commands/mainline-base.ts),
[`mainline-layer.ts`](../../../packages/sense/src/test-selection/mainline-layer.ts),
[`suite-share.ts`](../../../packages/cli/src/commands/suite-share.ts),
[`check.yml`](../../../.github/workflows/check.yml)

## Context

A checkout measures a change from a base record. Before this decision a
worktree that had not run read the primary checkout's record, which is
whatever that laptop last ran: another branch, a partial run, a commit main
left weeks ago. A pull request in CI read main's record, so the same change
was measured from two bases depending on where it ran, and the laptop's was
the one nobody could name.

Three readers chose a base on their own: `yarn test:since`, `variance select`
and the runner seams that lay a worktree's first record (`journal.ts`,
`jest-reporter.ts`, `selection-fold.ts`, `land.ts`). The first read main's
record when it could; the other two read the primary checkout's.

## Decision

**The base of every reader, local or CI, is the record main's CI published to
`refs/variance/mainline/main`, as of the last fetch on this machine. The
primary checkout's record is read only when no mainline record was ever
fetched here, and the reader says so.**

- **One order, one owner.** `suiteBase` answers: this checkout's own layer,
  else main's record, else the primary checkout's as the offline fallback.
  `test:since` and `select` ask it. `review` and `coverage` do not choose
  between layers: `review` asks the mainline only for a commit, and `coverage`
  compares against the mainline by definition.
- **The CLI fetches; the seams never do.** A fetch writes the record under
  `<cacheRoot>/share/read/<suite>/<commit>/` and names it, last, in
  `fetched.json` beside it. A seam laying a first record reads that name
  (`lastFetchedMainline`) and lays that record with the runs record it came
  with, seeded with `runs: 0` as the primary checkout's is
  (`layFetchedMainline`); with no name it lays the primary checkout's.
  Either way it prints which (`noteSeeded`). A test run never opens a
  connection, and a plain `yarn test` in a fresh worktree gets the same base
  `test:since` would have read.
- **A fetch is reused for ten minutes** (`MAINLINE_REUSE_MS`), and a remote
  that did not answer is not asked again for ten minutes (`unreached.json`).
  Past the window, a remote that does not answer leaves the record fetched
  earlier as the base, and the reader names when it was fetched and why it was
  not fetched now. `variance share --suite <name>` always asks.
- **Pruning keeps what `fetched.json` names.** A fetch runs the daily prune
  of ADR-0078 against the checkout being read, and the commit the name points
  at is never removed, however far off the line it is.

### What this amends in ADR-0077

1. **The suite job hands its record to the publish job as a workflow
   artifact, not through the Actions cache.** ADR-0077 keeps the Actions cache
   as the job-to-job carrier. Here the record goes from `suite` to `publish`
   with `upload-artifact`, one day's retention. An artifact belongs to one
   workflow run, so the publish job publishes exactly what this run's suite
   job made, and nothing a pull request's run saved is in reach of the job
   that holds `contents: write`.
2. **A `suite-v1` entry has three parts**, not two: `coverage.bin`, its case
   index `coverage.bin.cases.bin`, and the runs record `coverage.runs.json`,
   which says where each test file last ran. A reader diffs each test from
   that commit.
3. **`check.yml` names a path, and no suite.** `variance carry` prints the
   suites the root config gives to the share as `shared-suites`, and every
   step that reads, compares or publishes a base loops over it. The `keep the
   base record` step copies each base to `$RUNNER_TEMP/base-<suite>`, and
   the suite job hands every record to the publish job in one artifact, the
   directory they all sit under. `chromium` is not given to the share,
   because no browser runs in CI and `main` never records it whole.
   ADR-0077 says a workflow names no path; this is the exception, and
   `variance carry` does not answer for it yet.

### What a mainline publish refuses

- **A record that is not a whole run.** Every test file must have run at the
  publish commit. The runner owns which files it collects, so the publish job
  asks it (`yarn vitest list --filesOnly`) and passes the list with
  `--collected`. Without the list the publish is refused and says to pass
  `--collected`: git holds test files and every other file alike, so its tree
  cannot say which files the suite runs. `share --publish` takes no list, so
  it publishes a suite's record only to a branch line. A standing entry at the
  publish commit counts as run there.
  A commit git does not hold is named.
- **A refusal on a mainline fails the command** with `EXIT_OPERATOR`. Every
  pull request measures from this record, so an older one left in place must
  be seen. A branch line, or a run with no line, stays clean.
- **The token is the publish step's alone.** The checkout runs with
  `persist-credentials: false`, and the step hands git the header through
  `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0`, git's own
  configuration from the environment. Install scripts and the build never see
  it, and the share's `headerEnv` does not add the same header twice. No
  config field was added for it: git already carries it.

## Alternatives

- **The primary checkout as the base.** It is what the laptop last ran, not
  what main ran, and two checkouts of one change get two answers. Rejected by
  the owner's direction; it stays as the fallback when nothing was fetched.
- **The seams fetch.** A test run would open a network connection, read the
  share configuration and wait on a remote. Every seam would become a second
  fetcher with its own failure path. The CLI is the one that fetches.
- **Drop a file the suite no longer collects from the whole-run gate.** That
  is an operation nobody asked for, in a place nobody looks. The runner says
  what it collects, and the publish reads it.
- **Publish from the suite job.** It runs install scripts and the whole suite;
  giving it `contents: write` hands the token to every dependency.

## Cost

- A reader can be ten minutes behind a push to main.
- The publish job runs `vitest list` as well as the build.
- `check.yml` names `$RUNNER_TEMP/base-<suite>`, a literal ADR-0077 set out
  to remove.
- A developer who never runs `variance share --suite <name>`, `test:since` or
  `select` has never fetched, and their seams lay the primary checkout's
  record. They are told so each time.
