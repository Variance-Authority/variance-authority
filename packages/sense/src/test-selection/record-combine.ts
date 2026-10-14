import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { native, nativeRefusal } from '../native.js';
import { commitRunsFile } from './commit-runs.js';
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
 * records: the cached base moved while they ran, and a test may have run in no
 * shard. Every fold of shards in the product is this one, in the native addon.
 */
export function combineRecords(shards: readonly string[], output: string): NativeCombinedRecord {
  const combine = native()?.combineRecords;
  if (combine === undefined) {
    throw new Error(`combining records requires the Sense native addon: ${nativeRefusal() ?? 'the loaded addon has no `combineRecords`'}`);
  }
  const paths = shards.map((shard) => resolve(shard));
  return combine(paths, resolve(output), paths.map(startOf));
}

/**
 * The commit of the record the shard at `path` was laid over, and split the
 * suite by, as the runs record beside it names it; `null` when it has none, or
 * none that parses, which says nothing about the start either way.
 */
function startOf(path: string): string | null {
  let text: string;
  try {
    text = readFileSync(commitRunsFile(path), 'utf8');
  } catch {
    return null;
  }
  try {
    const over = (JSON.parse(text) as { over?: unknown }).over;
    return typeof over === 'string' ? over : null;
  } catch {
    return null;
  }
}
