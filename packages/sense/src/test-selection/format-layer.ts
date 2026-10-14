import { readFile } from 'node:fs/promises';
import { native, nativeRefusal } from '../addon.js';
import { digestString } from '../digest.js';
import { instrumentModeOf } from '../instrument/index.js';
import { encodeTestCoverage } from './format.js';
import { carriedSources } from './carried-sources.js';
import { sourceCut } from './coverage-rows.js';
import { editReadings, type EditReadings } from './edit-readings.js';
import type { CoverageModule, TestCoverage } from './index.js';

/**
 * `current` laid over the record `previous`, as the bytes to put back: the
 * addon's lay, the one every writer lays through, read and written column to
 * column so a run that re-recorded ten modules of two hundred thousand never
 * makes the other rows objects.
 *
 * `onDisk` is the text each carried module has now where it moved
 * (`carriedSources`); those modules are cut again in it here, under the
 * snapshot's own recipe, and the lay carries their crossings onto the fresh
 * regions. `readings` says what each edit reached ({@link editReadings}).
 *
 * A `previous` this build cannot read is replaced by `current`, the bargain
 * `existingCoverage` makes on this path: refusing would let a truncated write
 * stop every later run from recording anything.
 */
export function layCoverage(
  previous: Uint8Array | undefined,
  current: TestCoverage,
  onDisk: ReadonlyMap<string, string> = new Map(),
  readings?: EditReadings,
): Buffer {
  const encoded = encodeTestCoverage(current);
  if (previous === undefined) return encoded;
  const lay = native()?.layRecords;
  if (lay === undefined) {
    throw new Error(`laying a run over a record requires the Sense native addon: ${nativeRefusal() ?? 'the loaded addon has no `layRecords`'}`);
  }
  const laid = lay(Buffer.from(previous.buffer, previous.byteOffset, previous.byteLength), encoded, {
    ...(onDisk.size === 0 ? {} : { recut: encodeTestCoverage(recut(current, onDisk)) }),
    ...(readings === undefined ? {} : { readings: Object.fromEntries(readings) }),
    replaceUnreadable: true,
  });
  return laid ?? encoded;
}

/**
 * Each module of `onDisk` cut in the text it has now, as a record under
 * `current`'s probes with no tests: a module whose text does not cut, or under
 * a recipe this build does not know, is one held not instrumented.
 */
function recut(current: TestCoverage, onDisk: ReadonlyMap<string, string>): TestCoverage {
  const mode = instrumentModeOf(current.instrumentation);
  const modules = [...onDisk].map(([file, text]): CoverageModule => {
    const fresh = mode === undefined ? undefined : sourceCut(text, file, mode);
    return fresh === undefined
      ? { file, sourceDigest: digestString(text), instrumented: false, blocks: [] }
      : { file, sourceDigest: fresh.sourceDigest, instrumented: true, blocks: fresh.rows };
  });
  return { version: current.version, instrumentation: current.instrumentation, tests: [], modules };
}

/**
 * The read-modify-write a run ends with: the index on disk, this run laid over
 * it, and the bytes to put back.
 *
 * A file that is not there, or is not one this build can read, is nothing to
 * lay over. That is `existingCoverage`'s bargain and the reasoning is its own:
 * refusing would let a truncated write stop every later run from recording
 * anything, and this is a runner's teardown, where the sentence is easiest to
 * miss.
 *
 * The edits the run was recorded over are read here too ({@link editReadings}),
 * so a body edit demotes the tests that entered the body and not every loader.
 */
export async function layeredCoverage(
  file: string,
  current: TestCoverage,
  root: string,
  cacheRoot?: string,
): Promise<Buffer> {
  let previous: Buffer;
  try {
    previous = await readFile(file);
  } catch {
    return encodeTestCoverage(current);
  }
  const onDisk = await carriedSources(root, previous, current);
  return layCoverage(previous, current, onDisk, await editReadings(root, previous, current, onDisk, cacheRoot));
}
