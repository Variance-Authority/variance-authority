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
combined record over it, reading both records' columns and writing the result
in one pass, and the landing takes under 5 s and 600 MiB, where it ran out of
heap.

`combineRecords(paths, output)` in `@variance-authority/sense/test-selection`
writes the record and returns `CombinedRecord`: the counts, the commit, the
files two shards' indexes cut differently, and one `CombinedShard` per shard
named, with its path, commit, files, and whether it measured coverage and
kept cases. A shard that observed nothing, as a shard job that ran no test
writes, is neutral: it agrees with every other shard.
`openTestCoverage` and `TestCoverageView`, `recordedRun` and `landedCoverage`,
and `followRowsIn` are exported for a landing that reads a combined record's
columns instead of decoding it.

Stitching journey artifacts writes each case's duration, the longest any
shard measured, and the case's lines, and refuses a case whose lines stand on
a file two shards cut into different regions.

On macOS and Linux the addon returns freed blocks of 4 MiB or more to the
system, so a native call that decodes large buffers one after another holds
the largest of them, not their sum.

**Breaking:**

- `journeys merge`, added since the last release, is `journeys combine`.
  It takes no `--root`, and it refuses an `--into` that is already there,
  shards included. To lay shards over a record that is there, run
  `variance journeys <shard.bin>... --into <record>`.
- `foldTestCoverage`, `CoverageShard` and `mergeExecutionIndexes` are removed
  from `@variance-authority/sense/test-selection`. Use `combineRecords`.
- Combining refuses, naming the shards, where a landing used to fold
  silently or drop what it could not read:
  - no records named;
  - a shard that is not there (`there is no record at <path>`), or a case
    index, before layer or last-run layer this build cannot read, the row
    spelling among them: record it again with this version;
  - shards that disagree about the commit or the instrumentation, a file
    built from different source, or a region described differently;
  - a test file two shards recorded;
  - a shard that kept cases beside one that kept none, or a case test file
    two shards ran;
  - shards that started from different records: before layers at different
    commits, or one file on different text before each;
  - an Eyes section that is not version 1, two different Eyes journals for
    one case and attempt, or an Eyes journal of a case the combined index
    does not hold, none kept among them;
  - a case whose lines stand on a file two shards cut into different
    regions: record every shard with one build.
