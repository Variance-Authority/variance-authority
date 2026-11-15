/**
 * The earlier readings of a case over the code its newest reading read, kept
 * so a reader can set one reading against another (spec 0072 item 2). A rerun
 * keeps the reading it replaces while its test file ran over the same inputs
 * and every module either reading entered stands at the same text; anything
 * that moved drops them, since they read other code. The section's bytes are
 * `readings-bytes.ts`'s, which selection never decodes.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { native, nativeRefusal } from '../addon.js';
import { digestString } from '../digest.js';
import { linesOf, valueAt } from './case-lines.js';
import { openSetExecutionIndex, type OpenedSetExecutionIndex } from './execution-set-format.js';
import type { CoverageModule, CoverageTest, TestCoverage } from './index.js';
import { decodeCase, decodeReadings, type ReadRegion, type StoredReading } from './readings-bytes.js';

/** Distinct readings kept per case, newest first. */
export const READINGS = 16;


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


/** What a case's reading is, read off an index. */
interface Read {
  readonly file: string;
  readonly stopped?: boolean;
  readonly regions: ReadRegion[];
  readonly modules: Set<string>;
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
  const buffer = (bytes: Uint8Array | undefined): Buffer | undefined => (bytes === undefined ? undefined : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
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

/** The regions `stored` names over `base`, as {@link difference} wrote them; its own where it holds them. */
function applied({ regions, gone, values, added }: Pick<StoredReading, 'regions' | 'gone' | 'values' | 'added'>, base: readonly ReadRegion[]): readonly ReadRegion[] {
  if (regions !== undefined) return regions;
  if (gone === undefined && values === undefined && added === undefined) return base;
  const charged = new Map(values ?? []);
  const dropped = new Set(gone ?? []);
  const own: ReadRegion[] = base.flatMap((region, place) => dropped.has(place) ? [] : [
    charged.has(place) ? [...region.slice(0, 5), charged.get(place)!] as unknown as ReadRegion : region,
  ]);
  for (const [place, region] of added ?? []) own.splice(place, 0, region);
  return own;
}

/**
 * A case's stored readings in full: the newest over `base`, the regions the
 * index it was laid into holds of the case, and each earlier one over the
 * newest; absent where the newest holds no regions and `base` is absent.
 */
function expanded(stored: readonly StoredReading[], base: readonly ReadRegion[] | undefined): Reading[] | undefined {
  const [first] = stored;
  if (first === undefined || (first.regions === undefined && base === undefined)) return undefined;
  const newest = applied(first, base ?? []);
  return stored.map((reading, at): Reading => ({
    count: reading.count,
    ...(reading.stopped === undefined ? {} : { stopped: reading.stopped }),
    regions: at === 0 ? newest : applied(reading, newest),
  }));
}

/** What each test file ran over when its cases were last read, as `section` names it; absent when it names none. */
export function inputsIn(section: Uint8Array | undefined): ReadonlyMap<string, string> | undefined {
  const { inputs } = decodeReadings(section);
  return inputs.size === 0 ? undefined : inputs;
}

/**
 * Every reading the record keeps of case `id`, newest first, the newest read
 * off `index`; absent when the record keeps no earlier reading of it.
 */
export function readingsOf(section: Uint8Array | undefined, index: Uint8Array | undefined, id: string): readonly Reading[] | undefined {
  const opened = index === undefined ? undefined : openSetExecutionIndex(index);
  const bytes = decodeReadings(section).cases.get(id);
  const stored = bytes === undefined ? [] : decodeCase(bytes);
  if (stored.length === 0) return undefined;
  const newest = opened === undefined || stored[0]?.regions !== undefined ? undefined : readsOf(opened, new Set([id])).get(id)?.regions;
  return expanded(stored, newest ?? []);
}

function stop(read: Pick<Read, 'stopped'>): { readonly stopped?: boolean } {
  return read.stopped === undefined ? {} : { stopped: read.stopped };
}

/** The readings of the cases `wanted` names that `index` holds, by id. */
function readsOf(index: OpenedSetExecutionIndex, wanted: ReadonlySet<string>): Map<string, Read> {
  const rows = new Map<number, Read>();
  const byId = new Map<string, Read>();
  for (const [row, test] of index.tests.entries()) {
    if (!wanted.has(test.id)) continue;
    const read: Read = { file: test.file, ...stop(test), regions: [], modules: new Set() };
    rows.set(row, read);
    byId.set(test.id, read);
  }
  if (rows.size === 0) return byId;
  const lines = new Map([...rows.keys()].map((row) => [row, linesOf(index.lines, row)]));
  for (const [place, module] of index.modules.entries()) {
    for (const [block, region] of module.blocks.entries()) {
      const set = module.called[block]!;
      for (const row of index.sets.members(set)) {
        const read = rows.get(row);
        if (read === undefined) continue;
        const caseLines = lines.get(row);
        const value = caseLines === undefined ? undefined : valueAt(caseLines, place, block);
        read.regions.push([module.file, region.name, region.path, region.startLine, region.endLine, value ?? null]);
        read.modules.add(module.file);
      }
    }
  }
  return byId;
}
