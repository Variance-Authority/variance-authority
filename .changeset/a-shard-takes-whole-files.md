---
'@variance-authority/sense': minor
'@variance-authority/playwright-test': minor
'@variance-authority/cli': patch
---

A shard takes whole files in every runner, and is placed without times too

Under `--shard k/n`, a Playwright config wrapped by `withTestSelection` now
places each spec file whole in one shard, by the time it took on the last
recorded run, as Vitest and Jest shards are placed. Playwright's own split,
which under `fullyParallel` divides a file's tests between shards, does not run.
The reporter places the shard in `preprocess`, after `--project`, `--grep` and
`.only`, and prints one line on stderr:
`variance-authority: shard 1/2 by checksum: 1 of 3 files; no times at …`.
A file several projects run, or `repeatEach` repeats, goes with all its copies
to one shard; setup and teardown projects are not placed, and a project with no
file in the shard is left out whole. This needs Playwright 1.62 or newer; on an
older one Playwright splits by test, and the reporter prints
`shard k/n was split by Playwright <version>, test by test, so a file can run in
two shards`.

When the record has no times, or none for the files collected, a Vitest, Jest
or Playwright shard places each file by a `sha256` checksum of its path and the
shard count, where Vitest and Jest used to fall back to the runner's split by
count. Adding a file changes no other file's shard. The line reads
`shard k/n by checksum: <m> of <n> files; <why>`, in place of
`split by the runner, by count: <why>`. A file the runner hands in more than
once is placed once, with every copy in one shard.

`shardOf(files, shard, times)` and `landingTimes(record, options)` are exported
from `@variance-authority/sense/test-selection`, for a seam that places a shard
by the same rule.

**Breaking:**

- A Vitest or Jest shard with no times is placed by checksum, not by your
  sequencer's `shard`. Your sequencer still sorts each shard.
- A Jest shard the checksum leaves no file fails with *No tests found*. Set
  `passWithNoTests` in your Jest configuration while a suite has no recorded
  times. A Vitest shard left no file passes.
