import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { native, nativeRefusal } from '../native.js';
import type { NativeCombinedRecord } from '../native-record.js';
import { cutRecord } from './format-layer.js';
import { repositoryRoot } from './repository-root.js';

export type { NativeCombinedRecord as CombinedRecord, NativeCombinedShard as CombinedShard } from '../native-record.js';

/**
 * The shard records at `shards` folded into the one record at `output`, as one
 * unsharded run of them would have written it: coverage, case index, before
 * layer, last-run layer and Eyes. The bytes do not depend on the order the
 * shards are named in.
 *
 * Shards that are not of one run are refused by name: two instrumentations,
 * one test file in two shards, or one module at two texts. So is a record this
 * build cannot read whole. Shards that started from different records — two
 * commits, two before layers, two texts of one module before them, or two
 * records their runs were laid over and split the suite by — fail the build as
 * unstable sharding, naming both records: the shards restored two cached
 * records, and a test may have run in no shard. Each record names the one its
 * run was laid over (`record-base.ts`), and one with no `run.base` part is
 * refused. Every fold of shards in the product is this one, in the native addon.
 *
 * A module the shards describe two ways over one text is one a shard cut and
 * another carried from a record an older writer cut. Those alone are read from
 * the checkout `root` sits in and cut again, and the fold carries every shard's
 * crossings onto that cut by address; a test whose crossings have no place in
 * it is owed a run. A module the checkout holds at another text, or not at
 * all, is refused.
 */
export function combineRecords(shards: readonly string[], output: string, root: string): NativeCombinedRecord {
  const combine = native()?.combineRecords;
  if (combine === undefined) {
    throw new Error(`combining records requires the Sense native addon: ${nativeRefusal() ?? 'the loaded addon has no `combineRecords`'}`);
  }
  const paths = shards.map((shard) => resolve(shard));
  const folded = combine(paths, resolve(output));
  if (folded.disputed == null) return folded;
  const checkout = repositoryRoot(root);
  const onDisk = new Map<string, string>();
  for (const file of folded.disputed.files) {
    const text = checkoutText(resolve(checkout, file));
    if (text !== undefined) onDisk.set(file, text);
  }
  return combine(paths, resolve(output), cutRecord(folded.disputed.instrumentation, onDisk));
}

/** The text at `file`; nothing when there is no file there. */
function checkoutText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
