---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

Shard records combine natively, with `variance journeys combine`

`variance journeys combine <shard.bin>... --into <record>` writes the one
record an unsharded run of the shards would have written: coverage, case
index, last-run layer and Eyes, folded in the Sense native addon from the
shards alone. It reads no checkout and waits on no source index. The record
is the same bytes whatever order you name the shards in, and the same bytes
the TypeScript writers give for the unsharded run. Sixteen shards of a
200,000-module suite combine in about 4 s under 600 MiB, where the JavaScript
fold ran out of heap. `variance journeys <shard.bin>...` combines the same
way, then lands the combined record as the one run it was, reading its
columns rather than decoding it: the same sixteen shards land in about 4 s
under 600 MiB. Over the record a previous run left, the addon lays the
combined record over it in one pass, and the landing takes under 5 s and
600 MiB, where it ran out of heap. The landing lays over that record and
never rewrites the cached base a worktree reads through.

`combineRecords(paths, output)` in `@variance-authority/sense/test-selection`
writes the record and returns `CombinedRecord`: the counts, the commit, the
files two shards' indexes cut differently, and one `CombinedShard` per shard
named, with its path, commit, files, and whether it measured coverage and
kept cases. A shard that observed nothing, as a shard job that ran no test
writes, is neutral: it agrees with every other shard.
`openTestCoverage` and `TestCoverageView`, `recordedRun`, `RecordedRun` and
`landedCoverage`, and `followRowsIn` are exported for a landing that reads a
combined record's columns instead of decoding it.

Every writer lays a run over a record through the addon: the runner's
teardown, the milestone repin and the shard landing. Recording coverage over
an existing record now needs the native addon.

On macOS and Linux the addon returns freed blocks of 4 MiB or more to the
system, so a native call that decodes large buffers one after another holds
the largest of them, not their sum.

**Breaking:**

- `journeys merge`, added since the last release, is `journeys combine`.
  It takes no `--root`, and it refuses an `--into` that is already there,
  shards included. To lay shards over a record that is there, run
  `variance journeys <shard.bin>... --into <record>`.
- `foldTestCoverage`, `CoverageShard` and `mergeExecutionIndexes` are removed
  from `@variance-authority/sense/test-selection`. `combineRecords` replaces
  all three: it takes the shard records' paths and writes the combined
  record, coverage and case index together.
- `layerTestCoverage` is removed from the same entry point. Use
  `layeredCoverage(file, coverage, root)`, which reads the record at `file`
  and returns the laid bytes.
- `mergeCoverage` is removed from `@variance-authority/sense/test-selection`,
  `/vitest`, `/jest` and `/rstest`, with no alias. It was a second lay in
  JavaScript, and a fold through it ran out of heap. Combine shards with
  `combineRecords` and lay the result with `landedCoverage(previous, combined)`,
  bytes in and bytes out, or run `variance journeys <shard.bin>...`.
- A run is no longer laid over a record it cannot read, or one written under
  other probes: the runner's teardown, `variance land` and
  `landedCoverage` fail with the reason, where they used to replace the
  record or drop it silently. Such a record was written by another build;
  delete it and run again. Every record 0.15.0 reads is still read: format
  10, 9 (no cases) and 8 (no durations).
- Every record a run writes names the record it started from, in a new
  `run.base` part: `none` when the run was laid over no record, and otherwise
  the `sha256` digest of the record the first run at its commit was laid
  over. 0.15.0 cannot read a record that holds the part. A run whose shards
  started from different records fails the build: two bases, two commits,
  two before layers, one that began over no case index beside one that did
  not, or one file on two texts before them. The message names the shards and the
  records they started from, and says to run the whole build again so that
  every shard restores the same cached record through the `actions/cache`
  step. A shard that names no record it started from, as one written by
  0.15.0 or by the JVM agent does, is refused: record it again with this
  build.
- Combining refuses, naming the shards, where a landing used to fold
  silently or drop what it could not read:
  - a case index, before layer or last-run layer the combine cannot read;
  - a region two shards describe differently;
  - a shard that kept cases beside one that kept none, or a case test file
    two shards ran;
  - an Eyes section that is not version 1, two different Eyes journals for
    one case and attempt, or an Eyes journal of a case the combined index
    does not hold;
  - a case whose lines stand on a file two shards cut into different
    regions.
