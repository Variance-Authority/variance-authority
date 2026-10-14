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
 * The record `current` laid over the record `previous`, both as bytes, through
 * the addon's lay: the one lay every writer goes through, a runner's teardown
 * and a landing alike, read and written column to column so a run that
 * re-recorded ten modules of two hundred thousand never makes the other rows
 * objects. A `previous` that measured nothing is nothing to lay over, and
 * `current` lands as it is.
 *
 * One build reads what it wrote and records under one set of probes. So a
 * `previous` this build cannot read, or one under other probes, is another
 * build's, and the lay refuses it with the reason rather than drop its
 * evidence: the error names neither file, and the caller says which it was.
 */
export function layRecord(
  previous: Uint8Array,
  current: Uint8Array,
  options: { readonly recut?: Buffer; readonly readings?: EditReadings } = {},
): Buffer {
  const lay = native()?.layRecords;
  if (lay === undefined) {
    throw new Error(`laying a run over a record requires the Sense native addon: ${nativeRefusal() ?? 'the loaded addon has no `layRecords`'}`);
  }
  const bytes = (record: Uint8Array): Buffer => Buffer.from(record.buffer, record.byteOffset, record.byteLength);
  return lay(bytes(previous), bytes(current), {
    ...(options.recut === undefined ? {} : { recut: options.recut }),
    ...(options.readings === undefined ? {} : { readings: Object.fromEntries(options.readings) }),
  }) ?? bytes(current);
}

/**
 * `current` laid over the record `previous`, as the bytes to put back
 * ({@link layRecord}); `current` itself over nothing.
 *
 * `onDisk` is the text each carried module has now where it moved
 * (`carriedSources`); those modules are cut again in it here, under the
 * snapshot's own recipe, and the lay carries their crossings onto the fresh
 * regions. `readings` says what each edit reached ({@link editReadings}).
 */
export function layCoverage(
  previous: Uint8Array | undefined,
  current: TestCoverage,
  onDisk: ReadonlyMap<string, string> = new Map(),
  readings?: EditReadings,
): Buffer {
  const encoded = encodeTestCoverage(current);
  if (previous === undefined) return encoded;
  return layRecord(previous, encoded, {
    ...(onDisk.size === 0 ? {} : { recut: encodeTestCoverage(recut(current, onDisk)) }),
    ...(readings === undefined ? {} : { readings }),
  });
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
 * it, and the bytes to put back. A file that is not there is nothing to lay
 * over. One this build cannot read, or one under other probes, fails the run
 * with the reason and the file ({@link layRecord}).
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return encodeTestCoverage(current);
    throw error;
  }
  try {
    const onDisk = await carriedSources(root, previous, current);
    return layCoverage(previous, current, onDisk, await editReadings(root, previous, current, onDisk, cacheRoot));
  } catch (error) {
    throw anotherBuilds(file, error);
  }
}

/**
 * The record at `file` refused by a run that would lay over it: one this build
 * cannot read, or one under other probes, is another build's, and a run
 * neither replaces it nor drops its evidence. Deleting it is the operator's.
 */
export function anotherBuilds(file: string, error: unknown): Error {
  return new Error(
    `this run cannot be laid over the record at ${file}: ${error instanceof Error ? error.message : String(error)}. ` +
      'It was written by another build; delete it and run again.',
    { cause: error },
  );
}
