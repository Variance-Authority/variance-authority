---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

Shard records combine natively, and `journeys merge` only combines

`variance journeys merge` read every shard into JavaScript objects, folded
them, and landed the fold over the output through the checkout's case
landing, so a combine of a large sharded suite took tens of seconds and
gigabytes of memory, and waited on the source index first. The fold now
runs in the Sense native addon, `combineRecords`, and reads nothing but the
shards: coverage, case index, last-run layer and Eyes in one pass, the
dictionary and sets re-ranked rather than decoded, so 18 shards at a large
suite's shape combine in about three seconds where they took over
twenty. The record is the same bytes whatever order the shards are named
in. `variance journeys <shards…>` combines the same way
and lands the combined record as the one run it was.

**Breaking:**

- `journeys merge` takes no `--root`, waits on no index, and replaces
  `--into` rather than layering the shards over it. To lay shards over a
  record that is already there, run `variance journeys <shard.bin>... --into
  <record>`, which layers as `journeys merge` did; to land a combined record,
  `variance journeys <record>`.
- `foldTestCoverage`, `CoverageShard` and `mergeExecutionIndexes` are removed
  from `@variance-authority/sense/test-selection`; `combineRecords(paths,
  output)` writes the combined record and returns its counts,
  `CombinedRecord`.
- The combine refuses, naming the shard and what to do, where a landing used
  to lay nothing of it or fold it silently: a case index this build cannot
  read, the row spelling among them (record it again with this version); a
  shard that kept cases beside one that kept none; a test file whose cases two
  shards ran, naming both; and a case whose lines stand on a file two shards
  cut into different regions (record every shard with one build). A shard that
  is not there reads `there is no record at <path>`.
