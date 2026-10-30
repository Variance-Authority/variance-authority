/**
 * The earlier readings of a case over the code its newest reading read, kept
 * so a reader can set one reading against another (spec 0072 item 2). A rerun
 * keeps the reading it replaces while every module either entered stands at
 * the same text; a module that moved drops them, since they read other code.
 * The section is JSON, which selection never decodes.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { linesOf, valueAt } from './case-lines.js';
import { openSetExecutionIndex, type OpenedSetExecutionIndex } from './execution-set-format.js';
import { EMPTY } from './set-translation.js';

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
 * The section, by case id: a case is held only while it keeps a reading the
 * landed index does not, so a case read alike every run costs nothing. A file
 * the run did not finish is laid over its earlier crossings (`case-layer.ts`),
 * and a cut index holds less, so the newest reading of either keeps its
 * regions. The modules a case's readings entered are their regions' files.
 */
interface Section {
  readonly cases?: Readonly<Record<string, readonly StoredReading[]>>;
}

/** What a case's reading is, read off an index. */
interface Read {
  readonly stopped?: boolean;
  readonly regions: ReadRegion[];
  readonly modules: Set<string>;
}

/**
 * The readings section once `fresh` is laid over `previous` into `landed`:
 * `kept` the section the record held, `cases` every case it holds, and `same`
 * whether the run recorded `file` from the text `previous` holds it at. Absent
 * when no case holds a reading the index does not.
 */
export function layReadings(
  kept: Uint8Array | undefined,
  previous: Uint8Array | undefined,
  fresh: Uint8Array | undefined,
  landed: Uint8Array | undefined,
  cases: ReadonlySet<string>,
  same: (file: string) => boolean,
): Buffer | undefined {
  const before = previous === undefined ? undefined : openSetExecutionIndex(previous);
  const stored = parsed(kept);
  const run = fresh === undefined ? undefined : openSetExecutionIndex(fresh);
  if (fresh !== undefined && run === undefined) throw new Error('a case fold wrote an index it cannot open');
  const recorded = run?.modules.map((module) => module.file) ?? [];
  const ran = new Set(run?.tests.map((test) => test.id));
  const earlier = before === undefined ? new Map<string, Read>() : readsOf(before, new Set([...ran, ...stored.keys()]));
  const held = new Map<string, Reading[]>();
  for (const [id, readings] of stored) {
    const read = expanded(readings, earlier.get(id)?.regions);
    if (read !== undefined) held.set(id, read);
  }
  const now = run === undefined ? new Map<string, Read>() : readsOf(run, ran);
  const opened = landed === undefined ? undefined : openSetExecutionIndex(landed);
  const there = opened === undefined ? new Map<string, Read>() : readsOf(opened, new Set([...ran, ...held.keys()]));
  const laid = new Map<string, readonly Reading[]>();
  const entered = (id: string, readings: readonly Reading[]): Set<string> => new Set([
    ...earlier.get(id)?.modules ?? [],
    ...readings.flatMap((reading) => reading.regions.map(([file]) => file)),
  ]);
  // A case the run did not record keeps its readings while the code they read
  // stands: a module the run recorded at another text drops them.
  for (const [id, readings] of held) {
    if (ran.has(id) || !cases.has(id)) continue;
    const modules = entered(id, readings);
    if (recorded.some((file) => modules.has(file) && !same(file))) continue;
    laid.set(id, readings);
  }
  for (const [id, reading] of now) {
    const was = earlier.get(id);
    const prior = held.get(id) ?? (was === undefined ? [] : [{ count: 1, ...stop(was), regions: was.regions }]);
    const modules = new Set([...reading.modules, ...entered(id, prior)]);
    const readings = prior.length === 0 || ![...modules].every(same) ? [] : [...prior];
    const at = readings.findIndex((one) => alike(one, reading));
    const [found] = at === -1 ? [] : readings.splice(at, 1);
    const first = found === undefined
      ? { count: 1, ...stop(reading), regions: reading.regions }
      : { ...found, count: found.count + 1 };
    const kept = [first, ...readings].slice(0, READINGS);
    laid.set(id, kept);
  }
  for (const [id, readings] of laid) if (readings.length === 1 && alike(readings[0]!, there.get(id))) laid.delete(id);
  if (laid.size === 0) return undefined;
  const ids = [...laid.keys()].sort(codeUnitOrder);
  const section: Section = { cases: Object.fromEntries(ids.map((id) => [id, packed(laid.get(id)!, there.get(id))])) };
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

/**
 * Every reading the record keeps of case `id`, newest first, the newest read
 * off `index`; absent when the record keeps no earlier reading of it.
 */
export function readingsOf(section: Uint8Array | undefined, index: Uint8Array | undefined, id: string): readonly Reading[] | undefined {
  const opened = index === undefined ? undefined : openSetExecutionIndex(index);
  const stored = parsed(section).get(id);
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
    const read: Read = { ...stop(test), regions: [], modules: new Set() };
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

/** The section's readings by case. */
function parsed(section: Uint8Array | undefined): Map<string, readonly StoredReading[]> {
  const held = new Map<string, readonly StoredReading[]>();
  if (section === undefined) return held;
  let value: Section;
  try {
    value = JSON.parse(Buffer.from(section).toString('utf8')) as Section;
  } catch {
    return held;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return held;
  for (const [id, readings] of Object.entries(value.cases ?? {})) held.set(id, readings);
  return held;
}
