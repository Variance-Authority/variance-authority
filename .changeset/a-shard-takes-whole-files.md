---
'@variance-authority/sense': minor
'@variance-authority/playwright-test': minor
'@variance-authority/cli': patch
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
file in the shard is left out whole. This needs Playwright 1.62 or newer: on an
older one a run that asks for a shard is refused with a non-zero exit and
`variance-authority: refusing shard k/n: Playwright <version> would split it
test by test, …; placing whole files needs Playwright 1.62 or newer`. A run
with no shard runs as before.

When the record has no times, or none for the files collected, a Vitest, Jest
or Playwright shard prices every file the same and places them by the same
rule, so the shards are balanced by file count and none is left empty while
there are as many files as shards. The line reads
`shard k/n by file count: <m> of <n> files; <why>`, in place of
`split by the runner, by count: <why>`. A file the runner hands in more than
once is placed once, with every copy in one shard.

A Jest configuration wrapped by `withTestSelection` gets `passWithNoTests: true`
unless it sets `passWithNoTests` itself, so a shard left no file, because there
are fewer files than shards, passes as it does under Vitest and Playwright.

`shardOf(files, shard, times)` and `landingTimes(record, options)` are exported
from `@variance-authority/sense/test-selection`, for a seam that places a shard
by the same rule.

**Breaking:**

- A Vitest or Jest shard with no times is placed by file count, in code-unit
  order of path, not by your sequencer's `shard`. Your sequencer still sorts
  each shard.
- A Playwright run below 1.62 that asks for a shard is refused. Upgrade
  Playwright, or run without `--shard`.
