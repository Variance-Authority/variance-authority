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
  `--into` rather than layering the shards over it; land the result with
  `variance journeys <record>`.
- `foldTestCoverage` and `CoverageShard` are removed from
  `@variance-authority/sense/test-selection`; `combineRecords(paths, output)`
  writes the combined record and returns its counts, `CombinedRecord`.
- A shard whose case index this build cannot read, or one written in the
  row spelling, is refused by name where a landing used to lay nothing of it;
  so is a shard that kept cases beside one that kept none. A shard that is not
  there reads `there is no record at <path>`.
