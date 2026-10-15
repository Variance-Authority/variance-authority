---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

Shard records combine natively, with `variance journeys combine`

Compared with 0.15.0, the last release.

`variance journeys combine <shard.bin>... --into <record>` writes the one
record an unsharded run of the shards would have written: coverage, case
index, last-run layer and Eyes, folded in the Sense native addon from the
shards alone. It reads no checkout and waits on no source index, and the
record is the same bytes whatever order you name the shards in. It prints one
line, `journeys: combined <n> records into <record> (<tests> tests, <modules>
modules, <crossings> crossings, <cases> cases, recorded at <commit>)`.

`variance journeys <shard.bin>... --into <record>` combines the same way, then
lands the combined record as the one run it was, reading its columns rather
than decoding it, and lays it over the record a previous run left in one pass.
Sixteen shards of a 200,000-module suite, where 0.15.0 ran out of heap after
22–26 s at 4.6–4.8 GiB, now combine in 3.8–4.2 s and land in 4.0–5.3 s, all
under the 600 MiB peak the scale gates fail above, on an Apple M4 Max.
After the landing, `journeys` reads the landed record to report journeys, and
at that scale the reading still runs out of heap, as it does in 0.15.0; a CI
job that only combines runs `journeys combine`.

The landing lays over that record and never rewrites the cached base a
worktree reads through: in a worktree, `variance journeys --into` refuses the
primary checkout's record, and `writesBase(layers, file)` says whether a path
is that record.

`combineRecords(paths, output)` in `@variance-authority/sense/test-selection`
writes the record and returns `CombinedRecord`: the counts, the commit, the
files two shards' indexes cut differently, and one `CombinedShard` per shard
named, with its path, commit, files, and whether it measured coverage and
kept cases. A shard that observed nothing, as a shard job that ran no test
writes, adds nothing, and must still have read the record the others did. `openTestCoverage` and `TestCoverageView`, `recordedRun`, `RecordedRun`,
`landedCoverage`, and `followRowsIn` are exported for a
landing that reads a combined record's columns instead of decoding it.

Every writer lays a run over a record through the addon: the runner's
teardown, the milestone repin (which rebuilds a checkout's record on a newer
mainline snapshot, keeping the tests the checkout ran) and the shard landing. Recording coverage
over an existing record now needs the native addon, which ships prebuilt for
macOS arm64, Linux arm64 and x64 with glibc, and Windows x64; elsewhere it
builds from source with a Rust toolchain. Joining two readings of one file —
two cuts of its regions, as a run that edited it holds — needs the addon too,
in any run.

`variance journeys stitch` joins the parts of one case over the regions each
part crossed: each region keeps the line of the part that crossed it, the
case's own crossing before a hook's, then the earlier line. The last part's
lines used to replace the others'. It carries case lines and durations into
the stitched artifact, and refuses a part whose lines hold no line for a
region it crossed, and a case whose lines stand on a file two parts cut into
different regions.

On macOS and Linux the addon returns freed blocks of 4 MiB or more to the
system, so a native call that decodes large buffers one after another holds
the largest of them, not their sum. With the system allocator alone, the
combine above peaked at 0.84–0.98 GiB and the landing at 0.59–0.98 GiB.

Nothing in a CI workflow changes. The cached record is restored as before, by
the `actions/cache` step keyed
`variance-${{ runner.os }}-${{ runner.arch }}-${{ github.sha }}`, and a record
0.15.0 wrote is read and laid over: format 10, 9 (no cases) and 8 (no
durations). What changes is the record a run writes, below.

**Breaking:**

- Every record a run writes names the record it started from, in a new
  `run.base` part: the `sha256` digest of the record its selection read
  and placed its tests by, and, where the run was laid over another,
  `<read> over <laid>`. A side that is no record is `none`, and a run that
  read none and was laid over none writes `none`. A later run at the same
  commit carries the base the first one wrote. The JVM agent writes `none`:
  Surefire or Gradle hands it the classes a separate `variance select`
  chose, and it builds its snapshot from its own rows. 0.15.0 reads such a
  record's coverage and refuses its case index with an unknown section,
  `run.base`.
- Shards that started apart fail the build. Two that chose their tests from
  two records are named with the record each read, and the message says to
  run the whole build again so every shard reads the same record: this
  checkout's, restored by the `actions/cache` step, or else the mainline's
  from the share. Two that read one record but were laid over two are named
  with the records they were laid over. So are two commits, two before
  layers (the case index each shard's run started from), one that began
  over no case index beside one that did, and one file on two texts before
  them.
- A run whose selection and times read two records fails before it runs,
  naming both: one shard started from two records.
- A shard written by 0.15.0 names no base, and combining it with shards of
  this version or alone fails, naming which shards each version wrote and saying to
  run every shard on one version, the one that combines them.
- A run is no longer laid over a record it cannot read, or one written under
  other probes: the runner's teardown, `variance land` and `landedCoverage`
  fail with the reason, where 0.15.0 replaced the record or dropped it
  silently. Such a record was written by another build; delete it and run
  again.
- `foldTestCoverage`, `CoverageShard` and `mergeExecutionIndexes` are removed
  from `@variance-authority/sense/test-selection`. `combineRecords` replaces
  all three: it takes the shard records' paths and writes the combined
  record, coverage and case index together. It refuses an empty list of
  paths.
- `layerTestCoverage` is removed from the same entry point. Use
  `layeredCoverage(file, coverage, root)`, which reads the record at `file`
  and returns the laid bytes; for a record laid over nothing,
  `encodeTestCoverage(coverage)`, the counterpart to `decodeTestCoverage`.
- `mergeCoverage` is removed from `@variance-authority/sense/test-selection`,
  `/vitest`, `/jest` and `/rstest`, with no alias. Combine shards with
  `combineRecords` and lay the result with `landedCoverage(previous,
  combined)`, bytes in and bytes out, or run
  `variance journeys <shard.bin>...`.
- `CaseLanding`'s unanswered landing names its shards as a list:
  `shard: string` is `shards: readonly string[]`.
- `journeys merge`, added after 0.15.0 and never released, is
  `journeys combine`. It takes no `--root`, which fails as a flag
  `journeys` does not have, and it refuses an `--into` that is already
  there, shards included. To lay shards over a record that is there, run
  `variance journeys <shard.bin>... --into <record>`.
- Combining refuses, naming the shards, where 0.15.0 folded silently or
  dropped what it could not read:
  - a case index, before layer or last-run layer the combine cannot read;
  - a region two shards describe differently;
  - a shard that kept cases beside one that kept none;
  - a test file two shards ran, whether they recorded its coverage or its
    cases;
  - an Eyes section that is not version 1, two different Eyes journals for
    one case and attempt, or an Eyes journal of a case the combined index
    does not hold;
  - a case whose lines stand on a file two shards cut into different
    regions.
