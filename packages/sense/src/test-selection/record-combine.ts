import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { native, nativeRefusal } from '../addon.js';
import type { NativeCombinedRecord } from '../native-record.js';
import { readingsOver } from './case-readings.js';
import { caseSectionsOf, withCaseSections } from './case-record.js';
import { encodeAsSetExecutionIndex } from './execution-set-format.js';
import { cutRecord } from './format-layer.js';
import { repositoryRoot } from './repository-root.js';

/**
 * The shard records at `shards` folded into the one record at `output`, as one
 * unsharded run of them would have written it, whatever order they are named
 * in. Every fold of shards in the product is this one, in the native addon.
 *
 * Shards that are not of one run, or a record this build cannot read whole,
 * are refused by name. Shards that started from different records fail as
 * unstable sharding, naming both, since a test may have run in no shard. Each
 * record names the one its run was laid over (`record-base.ts`).
 */
export function combineRecords(shards: readonly string[], output: string, root: string): NativeCombinedRecord {
  const combine = native()?.combineRecords;
  if (combine === undefined) {
    throw new Error(`combining records requires the Sense native addon: ${nativeRefusal() ?? 'the loaded addon has no `combineRecords`'}`);
  }
  const paths = shards.map((shard) => resolve(shard));
  const readings = wholeReadings(paths);
  const folded = combine(paths, resolve(output), undefined, readings);
  if (folded.disputed == null) return storedAgainstIndex(resolve(output), folded);
  // A module the shards describe two ways over one text is one a shard cut and another carried
  // from a record an older writer cut. Those alone are cut again from the checkout `root` sits
  // in, and the fold carries every shard's crossings onto that cut by address; a module the
  // checkout holds at another text, or not at all, is refused.
  const checkout = repositoryRoot(root);
  const onDisk = new Map<string, string>();
  for (const file of folded.disputed.files) {
    const text = bytesAt(resolve(checkout, file))?.toString('utf8');
    if (text !== undefined) onDisk.set(file, text);
  }
  return storedAgainstIndex(resolve(output), combine(paths, resolve(output), cutRecord(folded.disputed.instrumentation, onDisk), readings));
}

/** An index holding no case, against which every reading is stored whole. */
const NO_CASES = encodeAsSetExecutionIndex({ tests: [], modules: [] });

/**
 * Each shard's readings by path, every one written whole, and empty where it
 * keeps none: a newest reading is stored as its difference from the shard's
 * case index, and the fold re-cuts and renumbers that index.
 */
function wholeReadings(paths: readonly string[]): Record<string, Buffer> {
  const whole: Record<string, Buffer> = {};
  for (const path of paths) {
    // A shard that is not there is refused by name in the fold.
    const bytes = bytesAt(path);
    if (bytes === undefined) continue;
    const { readings, index } = caseSectionsOf(bytes);
    if (readings === undefined || index === undefined) continue;
    whole[path] = readingsOver(readings, index, NO_CASES) ?? Buffer.alloc(0);
  }
  return whole;
}

/** `folded`, once the readings it wrote whole at `output` are stored against the case index written beside them. */
function storedAgainstIndex(output: string, folded: NativeCombinedRecord): NativeCombinedRecord {
  const bytes = readFileSync(output);
  const sections = caseSectionsOf(bytes);
  if (sections.readings === undefined || sections.index === undefined) return folded;
  // Whole readings read back alike against any index, so a reader that opens `output` before the rename reads them right.
  // Not `writeCoverageBytes`: it is async, and `combineRecords` is a synchronous published export.
  const stored = `${output}.${process.pid}.readings`;
  const { readings: whole, ...rest } = sections;
  const readings = readingsOver(whole, NO_CASES, sections.index);
  writeFileSync(stored, withCaseSections(bytes, readings === undefined ? rest : { ...rest, readings }));
  renameSync(stored, output);
  return folded;
}

/** The bytes at `file`; nothing when there is no file there. */
function bytesAt(file: string): Buffer | undefined {
  try {
    return readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
