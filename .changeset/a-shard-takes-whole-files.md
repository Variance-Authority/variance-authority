---
'@variance-authority/core': minor
'@variance-authority/sense': minor
'@variance-authority/playwright-test': minor
'@variance-authority/cli': minor
---

A shard takes whole files in every runner, and is balanced by file count without times

Under `--shard k/n`, a Playwright config wrapped by `withTestSelection` now
places each spec file whole in one shard, by the time it took on the last
recorded run, as Vitest and Jest shards are placed. Playwright's own split,
which under `fullyParallel` divides a file's tests between shards, does not run.
The reporter places the shard in `preprocess`, after `--project`, `--grep` and
`.only`, and prints one line on stderr:
`variance-authority: shard 1/2 by file count: 2 of 3 files; no times at …`.
A file several projects run, or `repeatEach` repeats, goes with all its copies
to one shard; setup and teardown projects are not placed, and a project with no
file in the shard is left out whole. Playwright runs a setup project in every
shard that needs it, so combining the shards' records refuses its files as run
by two shards. `PWTEST_SHARD_WEIGHTS` has no effect under the placement.

This needs Playwright 1.62 or newer. `withTestSelection` refuses a run that asks
for a shard, by `--shard` or by `shard` in the configuration, when the
configuration is evaluated, before any test starts: on an older Playwright with
`variance-authority: refusing shard k/n: Playwright <version> would split it
test by test, …; placing whole files needs Playwright 1.62 or newer`, and when
a `--reporter` on the command line replaces the configuration's reporters
without naming `@variance-authority/playwright-test/reporter`. A run with no
shard runs as before.

When the record has no times, or none for the files collected, a Vitest, Jest
or Playwright shard prices every file the same and places them by the same
rule, so the shards are balanced by file count and none is left empty while
there are as many files as shards. The line reads
`shard k/n by file count: <m> of <n> files; <why>`, in place of
`split by the runner, by count: <why>`. A file the runner hands in more than
once, for each project that runs it, is placed once at its recorded time, which
already sums every project, with every copy in one shard.

`place` in `@variance-authority/core/shard` is where that rule lives: with
nothing recorded, every group weighs one and is placed longest first on the
least-loaded shard like a timed one, ties broken by key in code-unit order and
then by the lowest shard. Its `by` reads `count` rather than `checksum`, and
its `cost` and `load` are always present, one per group when placed by count.
`variance run --shard` and `variance collect --shard` place stories and routes
by the same rule, and a subject another shard owns reads
`assigned to shard k/n by count, …`.

A Jest or Vitest configuration wrapped by `withTestSelection` and evaluated
under `--shard` gets `passWithNoTests: true` unless it sets `passWithNoTests`
itself, so a shard left no file, because there are fewer files than shards,
passes as it does under Playwright. Vitest 4 refused such a run before any file
was placed. An unsharded run that finds no file still fails.

`shardOf(files, shard, times)`, `landingTimes(record, options)` and
`shardArgument(argv)`, which reads the `--shard k/n` a command line asks for, are exported
from `@variance-authority/sense/test-selection`, for a seam that places a shard
by the same rule.

A Vitest, Jest or Playwright shard that cannot read the record its times come
from now fails before any test runs, with
`variance-authority: the times this shard is placed by could not be read, …`
and the reason: a share that did not answer or answered with what does not
read, a record that is there and does not decode, or a CLI that throws as it
loads. It used to place by file count, beside shards that may have read the
times. A record that is not there, a share that holds none or is not
configured, and a CLI that is not installed still place by count. An unsharded
run reads no times and runs as before. `variance shards` fails the same way.

**Breaking:**

- A Vitest or Jest shard with no times is placed by file count, in code-unit
  order of path, not by your sequencer's `shard`. Your sequencer still sorts
  each shard.
- A Playwright run below 1.62 that asks for a shard is refused. Upgrade
  Playwright, or run without `--shard`.
- A sharded Playwright run whose `--reporter` leaves out
  `@variance-authority/playwright-test/reporter` is refused. Name it in
  `--reporter` too.
- `variance run --shard` and `variance collect --shard` with no recorded costs
  place each file by count, not by a checksum of the file and the shard. The
  shards are balanced, but adding a file can move others to another shard.
  A collection's `assignment` reads `count`.
- A sharded run whose share does not answer fails rather than placing by
  file count. Run the job again, or hand every shard the record fetched once.
