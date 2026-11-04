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
  `test:since`, `select` and `covering` ask it. `review` and `coverage` do not choose
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
- **A record fetched for one mainline is no record for another.** Only the CLI
  can work out which mainline is selected. A reader that works it out hands it to
  `lastFetchedMainline`, which passes over a pointer for any other. It also
  leaves it in `selected.json` in the checkout's cache, for a seam or a tool with
  no command line, which is judged by the last selection noted. A checkout no
  reader has asked in has no note, and its first run lays what was fetched.
- **A fetched record stands until a nearer one can exist.** The best base is
  the record at `HEAD`'s merge base with the mainline. The line holds its
  newest record, and a share in git also keeps each mainline publish at its
  commit (`refs/variance/at/<commit>/mainline/<name>`). Nothing removes those
  until somebody runs `variance share --purge-older-than <days>`; some never
  will, and a remote's own expiry is theirs too. The reader asks for the record
  at the merge base first. On a green main every commit's job publishes its
  record, so until the merge base's has, the reader reads the newest kept behind
  it that holds the suite's record, whichever jobs published there, which
  charges the change with no commit of main's it lacks. For a selection, the
  commits between that record and the merge base count as changed with the
  checkout's own, because that record cannot say what they made a test load: a
  selection widens to stay safe. `covering --since` answers what the change
  changed, so it reads the diff from the record's commit and keeps the hunks that
  meet the diff from the merge base in the working tree. A path that commit held
  no file by is not held, whatever git calls a rename, and the answer says so
  rather than reading another name for it. The newest of the line
  answers only when nothing at or behind is kept, and a directory or an HTTP
  store keeps the newest only. In a git share the record stands without asking
  only when it is at the merge base, since nothing is nearer. Anywhere else the
  line is asked on each read, because the merge base's job may publish yet. A
  directory or an HTTP store has nothing nearer to offer, so its newest stands
  once asked at this merge base, and past the merge base. Every reader of a
  checkout, and every CI job handed the read root, has one merge base and reads
  one record, except a `covering --text` question, which an editor asks on every
  repaint: it takes the same order, fetches nothing, and keeps the record fetched
  last. A remote that does not answer leaves the record fetched earlier as
  the base, and the reader names when it was fetched and why it was not fetched
  now. `variance share --suite <name>` always asks.
- **A miss stands for ten minutes** (`MISS_STANDS_MS`). The line's answer that
  it gave no record, unreachable, holding none, or holding one that does not
  read (`missed.json`), names no commit to place it by, so a clock does.
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
3. **`check.yml` names no suite.** `variance carry` prints the suites the
   root config gives to the share as `shared-suites`, and every step that
   reads or publishes a base loops over it. The suite job hands every record
   to the publish job in one artifact, the directory they all sit under. The
   coverage the review prints reads each suite's base through the share, so
   no base is copied aside. `chromium` is not given to the share, because no
   browser runs in CI and `main` never records it whole.

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

- Away from the merge base, every read asks the line until the merge base's
  job publishes; a merge base whose job never does is asked at each read, at
  most once a minute, until a pull moves it.
- Kept records grow by one per green mainline commit until somebody purges.
- A suite that publishes rarely costs a read per kept commit between it and the
  merge base, and with nothing kept behind it the walk reads the whole
  first-parent history. Neither is measured.
- The publish job runs `vitest list` as well as the build.
- A developer who never runs `variance share --suite <name>`, `test:since`,
  `select` or `covering` has never fetched, and their seams lay the primary checkout's
  record. They are told so each time.
