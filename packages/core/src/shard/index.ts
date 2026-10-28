/**
 * `@variance-authority/core/shard` — which shard runs which group, and how
 * many shards a suite is worth.
 *
 * One rule for every kind of suite: the stories and routes `variance run
 * --shard` collects, and the test files a runner's `--shard` runs under a
 * seam. No I/O: the groups and their recorded times are handed in by whoever
 * read them.
 */

export {
  MATRIX_LIMIT,
  durationText,
  longestFirst,
  place,
  priced,
  shardCount,
  type Placeable,
  type Placement,
  type ShardCount,
  type ShardCountOptions,
  type ShardCountReason,
} from './placement.js';
