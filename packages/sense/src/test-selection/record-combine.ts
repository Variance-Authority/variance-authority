import { resolve } from 'node:path';
import { native, nativeRefusal } from '../native.js';
import type { NativeCombinedRecord } from '../native-record.js';

export type { NativeCombinedRecord as CombinedRecord, NativeCombinedShard as CombinedShard } from '../native-record.js';

/**
 * The shard records at `shards` folded into the one record at `output`, as one
 * unsharded run of them would have written it: coverage, case index, before
 * layer, last-run layer and Eyes. Nothing else is read — no checkout, no
 * source — and the bytes do not depend on the order the shards are named in.
 *
 * Shards that are not of one run are refused by name: two instrumentations,
 * one test file in two shards, one module at two texts, or one region
 * described two ways. So is a record this build cannot read whole. Shards that
 * started from different records — two commits, two before layers, two texts
 * of one module before them, or two records their runs were laid over and
 * split the suite by — fail the build as unstable sharding, naming both
 * records: the shards restored two cached records, and a test may have run in
 * no shard. Each record names the one its run was laid over
 * (`record-base.ts`), and one with no `run.base` part is refused. Every fold of shards
 * in the product is this one, in the native addon.
 */
export function combineRecords(shards: readonly string[], output: string): NativeCombinedRecord {
  const combine = native()?.combineRecords;
  if (combine === undefined) {
    throw new Error(`combining records requires the Sense native addon: ${nativeRefusal() ?? 'the loaded addon has no `combineRecords`'}`);
  }
  return combine(shards.map((shard) => resolve(shard)), resolve(output));
}

