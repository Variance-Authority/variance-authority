/**
 * The earlier readings of a case over the code its newest reading read, kept
 * so a reader can set one reading against another (spec 0072 item 2). A rerun
 * keeps the reading it replaces while its test file ran over the same inputs
 * and every module either reading entered stands at the same text; anything
 * that moved drops them, since they read other code. The native addon lays and
 * reads the section; selection never decodes it.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { native, nativeRefusal } from '../addon.js';
import { digestString } from '../digest.js';
import type { CoverageModule, CoverageTest, TestCoverage } from './index.js';
import { decodeReadings, type ReadRegion } from './readings-bytes.js';

/**
 * One recorded run of one case, and how many runs read it so: an equal reading
 * raises the count rather than being stored again, so a case that reads the
 * same every time costs its count.
 */
export interface Reading {
  readonly count: number;
  /** As the case's own `stopped` says it: absent when the producer could not see how it settled. */
  readonly stopped?: boolean;
  /** Every region it crossed, in module and region order. */
  readonly regions: readonly ReadRegion[];
}

/** What a run tells the readings of the cases it ran. */
export interface ReadingsRun {
  /** The run's own case index. */
  readonly fresh: Uint8Array;
  /** The cases of `fresh` whose files the run announced: a shard's index also holds what its seed carried, which it did not run. */
  readonly announced: ReadonlySet<string>;
  /** Every file the run recorded from the text the index laid over holds it at. */
  readonly same: readonly string[];
  /** {@link inputsOf} the run's coverage; absent when it measured nothing. */
  readonly inputs?: ReadonlyMap<string, string>;
}

/**
 * The digest of what each test file `coverage` ran over: every module some
 * region of which it entered or loaded, at the text it was recorded from, and
 * the file's preconditions — its source, setup, configuration and mocks.
 */
export function inputsOf(coverage: Pick<TestCoverage, 'modules'> & { readonly tests: readonly Pick<CoverageTest, 'file' | 'preconditions'>[] }): Map<string, string> {
  const read = new Map<string, Set<CoverageModule>>(coverage.tests.map((test) => [test.file, new Set()]));
  for (const module of coverage.modules) {
    for (const block of module.blocks) {
      for (const file of [...block.testFiles, ...block.loadedBy ?? []]) read.get(file)?.add(module);
    }
  }
  return new Map(coverage.tests.map((test) => [test.file, digestString(JSON.stringify([
    [...read.get(test.file)!].map((module) => [module.file, module.sourceDigest]).sort(([left], [right]) => codeUnitOrder(left!, right!)),
    [...test.preconditions].map((input) => [input.name, input.digest]).sort(([left], [right]) => codeUnitOrder(left!, right!)),
  ]))]));
}

/**
 * The readings section once `run` is laid over `previous` into `landed`: `kept`
 * the section the record held, and `cases` every case it holds. A case `run`
 * ran keeps its earlier readings while its file ran over the same inputs and
 * every module they entered stands at the same text. Absent when no case
 * holds a reading the index does not, and no file has inputs to name. The
 * addon lays it; nothing lays it without the addon.
 */
export function layReadings(
  kept: Uint8Array | undefined,
  previous: Uint8Array | undefined,
  landed: Uint8Array | undefined,
  cases: ReadonlySet<string>,
  run?: ReadingsRun,
): Buffer | undefined {
  const lay = native()?.layReadings;
  if (lay === undefined) throw new Error(`laying case readings requires the Sense native addon: ${nativeRefusal() ?? 'the loaded addon has no `layReadings`'}`);
  return lay(
    buffer(kept),
    buffer(previous),
    buffer(landed),
    [...cases],
    buffer(run?.fresh),
    [...run?.announced ?? []],
    [...run?.same ?? []],
    run?.inputs === undefined ? undefined : [...run.inputs],
  ) ?? undefined;
}

/** What each test file ran over when its cases were last read, as `section` names it; absent when it names none. */
export function inputsIn(section: Uint8Array | undefined): ReadonlyMap<string, string> | undefined {
  const { inputs } = decodeReadings(section);
  return inputs.size === 0 ? undefined : inputs;
}

/**
 * Every reading the record keeps of case `id`, newest first, the newest read
 * off `index`; absent when the record keeps no earlier reading of it. The
 * addon reads it; nothing reads it without the addon.
 */
export function readingsOf(section: Uint8Array | undefined, index: Uint8Array | undefined, id: string): readonly Reading[] | undefined {
  if (section === undefined) return undefined;
  const read = native()?.readingsOfCase;
  if (read === undefined) throw new Error(`reading case readings requires the Sense native addon: ${nativeRefusal() ?? 'the loaded addon has no `readingsOfCase`'}`);
  return read(buffer(section)!, buffer(index), id)?.map(({ count, stopped, regions }): Reading => ({
    count,
    ...(stopped === undefined || stopped === null ? {} : { stopped }),
    regions: regions.map(({ module, name, path, start, end, value }): ReadRegion => [module, name, path, start, end, value ?? null]),
  }));
}

/**
 * The regions case `id` crossed as `index` holds its newest run, each with the
 * line charged; absent when the index holds no such case. The addon reads it.
 */
export function newestRegions(index: Uint8Array, id: string): readonly ReadRegion[] | undefined {
  const read = native()?.newestRegionsOfCase;
  if (read === undefined) throw new Error(`reading a case's regions requires the Sense native addon: ${nativeRefusal() ?? 'the loaded addon has no `newestRegionsOfCase`'}`);
  return read(buffer(index)!, id)?.map(({ module, name, path, start, end, value }): ReadRegion => [module, name, path, start, end, value ?? null]);
}

function buffer(bytes: Uint8Array | undefined): Buffer | undefined {
  return bytes === undefined ? undefined : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
