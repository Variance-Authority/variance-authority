/**
 * The earlier readings of a case over the code its newest reading read, kept
 * so a reader can set one reading against another (spec 0072 item 2). A rerun
 * keeps the reading it replaces while its test file ran over the same inputs
 * and every module either reading entered stands at the same text; anything
 * that moved drops them, since they read other code. The section is JSON,
 * which selection never decodes.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { digestString } from '../digest.js';
import { linesOf, valueAt } from './case-lines.js';
import { openSetExecutionIndex, type OpenedSetExecutionIndex } from './execution-set-format.js';
import { EMPTY } from './set-translation.js';
import type { CoverageModule, CoverageTest, TestCoverage } from './index.js';

/** Distinct readings kept per case, newest first. */
export const READINGS = 16;

/** One region a reading crossed: its module, its declaration's name and the path in it, its lines, and the value cadence charged it; null where no line was recorded. */
export type ReadRegion = readonly [module: string, name: string, path: string, startLine: number, endLine: number, value: number | null];

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

/**
 * A reading as stored. The newest holds no regions where the landed index
 * holds the case as it ran; an earlier one holds what it read otherwise than
 * the newest: the newest's regions it did not cross by position (`gone`), the
 * values it charged them otherwise (`values`), and the regions only it crossed,
 * each at its position among its own (`added`).
 */
interface StoredReading {
  readonly count: number;
  readonly stopped?: boolean;
  readonly regions?: readonly ReadRegion[];
  readonly gone?: readonly number[];
  readonly values?: readonly (readonly [at: number, value: number | null])[];
  readonly added?: readonly (readonly [at: number, region: ReadRegion])[];
}

/**
 * The section: each case's readings by id, and what each test file ran over
 * when its cases were last read. A case is held once it keeps more than one
 * run the landed index does not say: an earlier reading, or the count of the
 * runs read alike. A file the run did not finish is laid over its earlier
 * crossings (`case-layer.ts`), and a cut index holds less, so the newest
 * reading of either keeps its regions.
 */
interface Section {
  readonly cases?: Readonly<Record<string, readonly StoredReading[]>>;
  /** By test file, the digest {@link inputsOf} names: a region a module crossed only while it evaluated is no case's, so the regions alone do not say what a file loaded. */
  readonly inputs?: Readonly<Record<string, string>>;
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
  /** Whether the run recorded `file` from the text the index laid over holds it at. */
  readonly same: (file: string) => boolean;
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
 * holds a reading the index does not, and no file has inputs to name.
 */
export function layReadings(
  kept: Uint8Array | undefined,
  previous: Uint8Array | undefined,
  landed: Uint8Array | undefined,
  cases: ReadonlySet<string>,
  run?: ReadingsRun,
): Buffer | undefined {
  const before = previous === undefined ? undefined : openSetExecutionIndex(previous);
  const { cases: stored, inputs: held } = parsed(kept);
  const fresh = run === undefined ? undefined : openSetExecutionIndex(run.fresh);
  if (run !== undefined && fresh === undefined) throw new Error('a case fold wrote an index it cannot open');
  const recorded = fresh?.modules.map((module) => module.file) ?? [];
  const ran = run?.announced ?? new Set<string>();
  const same = run?.same ?? (() => true);
  const earlier = before === undefined ? new Map<string, Read>() : readsOf(before, new Set([...ran, ...stored.keys()]));
  const holding = new Map<string, Reading[]>();
  for (const [id, readings] of stored) {
    const read = expanded(readings, earlier.get(id)?.regions);
    if (read !== undefined) holding.set(id, read);
  }
  const now = fresh === undefined ? new Map<string, Read>() : readsOf(fresh, ran);
  const opened = landed === undefined ? undefined : openSetExecutionIndex(landed);
  const there = opened === undefined ? new Map<string, Read>() : readsOf(opened, new Set([...ran, ...holding.keys()]));
  const laid = new Map<string, readonly Reading[]>();
  const entered = (id: string, readings: readonly Reading[]): Set<string> => new Set([
    ...earlier.get(id)?.modules ?? [],
    ...readings.flatMap((reading) => reading.regions.map(([file]) => file)),
  ]);
  // A case the run did not record keeps its readings while the code they read
  // stands: a module the run recorded at another text drops them.
  for (const [id, readings] of holding) {
    if (ran.has(id) || !cases.has(id)) continue;
    const modules = entered(id, readings);
    if (recorded.some((file) => modules.has(file) && !same(file))) continue;
    laid.set(id, readings);
  }
  for (const [id, reading] of now) {
    const was = earlier.get(id);
    const prior = holding.get(id) ?? (was === undefined ? [] : [{ count: 1, ...stop(was), regions: was.regions }]);
    const modules = new Set([...reading.modules, ...entered(id, prior)]);
    const stands = run?.inputs?.get(reading.file) === held.get(reading.file) && [...modules].every(same);
    const readings = prior.length === 0 || !stands ? [] : [...prior];
    const at = readings.findIndex((one) => alike(one, reading));
    const [found] = at === -1 ? [] : readings.splice(at, 1);
    const first = found === undefined
      ? { count: 1, ...stop(reading), regions: reading.regions }
      : { ...found, count: found.count + 1 };
    laid.set(id, [first, ...readings].slice(0, READINGS));
  }
  // One run, as the index holds it, is what the index already says.
  for (const [id, readings] of laid) if (readings.length === 1 && readings[0]!.count === 1 && alike(readings[0]!, there.get(id))) laid.delete(id);
  const files = new Set(opened?.tests.map((test) => test.file));
  // A file the run carried keeps what it ran over when it last ran.
  const read = new Set([...now.values()].map((reading) => reading.file));
  const inputs = new Map([...held, ...[...run?.inputs ?? []].filter(([file]) => read.has(file))].filter(([file]) => files.has(file)));
  if (laid.size === 0 && inputs.size === 0) return undefined;
  const ids = [...laid.keys()].sort(codeUnitOrder);
  const section: Section = {
    ...(laid.size === 0 ? {} : { cases: Object.fromEntries(ids.map((id) => [id, packed(laid.get(id)!, there.get(id))])) }),
    ...(inputs.size === 0 ? {} : { inputs: Object.fromEntries([...inputs].sort(([left], [right]) => codeUnitOrder(left, right))) }),
  };
  return Buffer.from(JSON.stringify(section), 'utf8');
}

/** A case's readings as stored: the newest without its regions where the landed index holds them as they ran, each earlier one as what it read otherwise. */
function packed(readings: readonly Reading[], there: Read | undefined): StoredReading[] {
  const [newest, ...rest] = readings;
  const base = newest!.regions;
  const place = new Map(base.map((region, at) => [region.slice(0, 5).join('\0'), at]));
  return [
    alike(newest!, there) ? { count: newest!.count, ...stop(newest!) } : newest!,
    ...rest.map((reading): StoredReading => {
      const crossed = new Set<number>();
      const values: [number, number | null][] = [];
      const added: [number, ReadRegion][] = [];
      reading.regions.forEach((region, at) => {
        const from = place.get(region.slice(0, 5).join('\0'));
        if (from === undefined) return void added.push([at, region]);
        crossed.add(from);
        if (base[from]![5] !== region[5]) values.push([from, region[5]]);
      });
      const gone = base.flatMap((_, at) => crossed.has(at) ? [] : [at]);
      return {
        count: reading.count,
        ...stop(reading),
        ...(gone.length === 0 ? {} : { gone }),
        ...(values.length === 0 ? {} : { values }),
        ...(added.length === 0 ? {} : { added }),
      };
    }),
  ];
}

/** A case's stored readings in full, the newest's regions `base` where it holds none; absent where neither holds them. */
function expanded(stored: readonly StoredReading[], base: readonly ReadRegion[] | undefined): Reading[] | undefined {
  const newest = stored[0]?.regions ?? base;
  if (newest === undefined) return undefined;
  return stored.map(({ count, stopped, regions, gone, values, added }, at): Reading => {
    const read = { count, ...(stopped === undefined ? {} : { stopped }) };
    if (at === 0) return { ...read, regions: newest };
    if (regions !== undefined) return { ...read, regions };
    const charged = new Map(values ?? []);
    const dropped = new Set(gone ?? []);
    const own: ReadRegion[] = newest.flatMap((region, place) => dropped.has(place) ? [] : [
      charged.has(place) ? [...region.slice(0, 5), charged.get(place)!] as unknown as ReadRegion : region,
    ]);
    for (const [place, region] of added ?? []) own.splice(place, 0, region);
    return { ...read, regions: own };
  });
}

/** What each test file ran over when its cases were last read, as `section` names it; absent when it names none. */
export function inputsIn(section: Uint8Array | undefined): ReadonlyMap<string, string> | undefined {
  const { inputs } = parsed(section);
  return inputs.size === 0 ? undefined : inputs;
}

/**
 * Every reading the record keeps of case `id`, newest first, the newest read
 * off `index`; absent when the record keeps no earlier reading of it.
 */
export function readingsOf(section: Uint8Array | undefined, index: Uint8Array | undefined, id: string): readonly Reading[] | undefined {
  const opened = index === undefined ? undefined : openSetExecutionIndex(index);
  const stored = parsed(section).cases.get(id);
  if (stored === undefined) return undefined;
  const newest = opened === undefined || stored[0]?.regions !== undefined ? undefined : readsOf(opened, new Set([id])).get(id)?.regions;
  return expanded(stored, newest ?? []);
}

function stop(read: Pick<Read, 'stopped'>): { readonly stopped?: boolean } {
  return read.stopped === undefined ? {} : { stopped: read.stopped };
}

function alike(reading: Pick<Reading, 'stopped' | 'regions'>, read: Pick<Read, 'stopped' | 'regions'> | undefined): boolean {
  if (read === undefined) return false;
  if (reading.stopped !== read.stopped || reading.regions.length !== read.regions.length) return false;
  return reading.regions.every((region, at) => region.every((part, field) => part === read.regions[at]![field]));
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
      if (set === EMPTY) continue;
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

/** The section's readings by case, and its inputs by test file; a section `layReadings` did not write is refused. */
function parsed(section: Uint8Array | undefined): { readonly cases: Map<string, readonly StoredReading[]>; readonly inputs: Map<string, string> } {
  if (section === undefined) return { cases: new Map(), inputs: new Map() };
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(section).toString('utf8'));
  } catch (error) {
    throw new Error('the record\'s readings section is not JSON', { cause: error });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('the record\'s readings section is not an object');
  const { cases, inputs } = value as Section;
  return { cases: new Map(Object.entries(cases ?? {})), inputs: new Map(Object.entries(inputs ?? {})) };
}
