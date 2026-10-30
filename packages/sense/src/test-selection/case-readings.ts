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

/** Distinct readings kept per case, newest first: the bound a story keeps. */
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

/** A reading as stored: the newest holds no regions where the landed index holds the case as it ran. */
type StoredReading = Omit<Reading, 'regions'> & { readonly regions?: readonly ReadRegion[] };

/**
 * The section: a case whose one reading the landed index holds costs its count
 * in `counts`, at the case's row; any other is stored whole. A file the run did
 * not finish is laid over its earlier crossings (`case-layer.ts`), and a cut
 * index holds less, so the newest reading of either keeps its regions. The
 * modules a case's readings entered are their regions' files.
 */
interface Section {
  readonly counts?: readonly number[];
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
  const held = parsed(kept, before);
  const run = fresh === undefined ? undefined : openSetExecutionIndex(fresh);
  if (fresh !== undefined && run === undefined) throw new Error('a case fold wrote an index it cannot open');
  const recorded = run?.modules.map((module) => module.file) ?? [];
  const ran = new Set(run?.tests.map((test) => test.id));
  const earlier = before === undefined ? new Map<string, Read>() : readsOf(before, new Set([...ran, ...held.keys()]));
  const now = run === undefined ? new Map<string, Read>() : readsOf(run, ran);
  const opened = landed === undefined ? undefined : openSetExecutionIndex(landed);
  const there = opened === undefined ? new Map<string, Read>() : readsOf(opened, new Set([...ran, ...held.keys()]));
  const laid = new Map<string, readonly StoredReading[]>();
  const entered = (id: string, stored: readonly StoredReading[]): Set<string> => new Set([
    ...earlier.get(id)?.modules ?? [],
    ...stored.flatMap((reading) => reading.regions?.map(([file]) => file) ?? []),
  ]);
  // A case the run did not record keeps its readings while the code they read
  // stands: a module the run recorded at another text drops them.
  for (const [id, stored] of held) {
    if (ran.has(id) || !cases.has(id)) continue;
    const modules = entered(id, stored);
    if (recorded.some((file) => modules.has(file) && !same(file))) continue;
    const [newest, ...rest] = stored;
    const regions = newest!.regions ?? earlier.get(id)?.regions ?? [];
    laid.set(id, [lain({ ...newest!, regions }, there.get(id)), ...rest]);
  }
  for (const [id, reading] of now) {
    const stored = held.get(id);
    const was = earlier.get(id);
    const newest = stored?.[0];
    const wasRegions = newest?.regions ?? was?.regions;
    const modules = new Set([...reading.modules, ...(wasRegions === undefined ? [] : [...entered(id, stored ?? []), ...wasRegions.map(([file]) => file)])]);
    const readings: Reading[] = wasRegions === undefined || ![...modules].every(same) ? [] : [
      { ...(newest ?? { count: 1 }), ...stop(newest ?? was!), regions: wasRegions },
      ...(stored?.slice(1) ?? []) as Reading[],
    ];
    const at = readings.findIndex((one) => alike(one, reading));
    const [found] = at === -1 ? [] : readings.splice(at, 1);
    const first = found === undefined
      ? { count: 1, ...stop(reading), regions: reading.regions }
      : { ...found, count: found.count + 1 };
    const kept = [first, ...readings].slice(0, READINGS);
    if (kept.length === 1 && first.count === 1 && alike(first, there.get(id))) continue;
    laid.set(id, [lain(kept[0]!, there.get(id)), ...kept.slice(1)]);
  }
  if (laid.size === 0) return undefined;
  const counts = (opened?.tests ?? []).map(({ id }) => {
    const [only, ...rest] = laid.get(id) ?? [];
    if (only === undefined || only.regions !== undefined || rest.length > 0) return 0;
    laid.delete(id);
    return only.count;
  });
  const ids = [...laid.keys()].sort(codeUnitOrder);
  const section: Section = {
    ...(counts.some((count) => count > 0) ? { counts } : {}),
    ...(ids.length === 0 ? {} : { cases: Object.fromEntries(ids.map((id) => [id, laid.get(id)!])) }),
  };
  return Buffer.from(JSON.stringify(section), 'utf8');
}

/** The newest reading as stored: without its regions where the landed index holds them as they ran. */
function lain(reading: Reading, there: Read | undefined): StoredReading {
  return alike(reading, there) ? { count: reading.count, ...stop(reading) } : reading;
}

/**
 * Every reading the record keeps of case `id`, newest first, the newest read
 * off `index`; absent when the record keeps no earlier reading of it.
 */
export function readingsOf(section: Uint8Array | undefined, index: Uint8Array | undefined, id: string): readonly Reading[] | undefined {
  const opened = index === undefined ? undefined : openSetExecutionIndex(index);
  const stored = parsed(section, opened).get(id);
  if (stored === undefined) return undefined;
  const newest = opened === undefined || stored[0]?.regions !== undefined ? undefined : readsOf(opened, new Set([id])).get(id)?.regions;
  return stored.map((reading) => ({ ...reading, regions: reading.regions ?? newest ?? [] }));
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

/** The section's readings by case, a counted case's stop read off `index`, the index it was laid into. */
function parsed(section: Uint8Array | undefined, index: OpenedSetExecutionIndex | undefined): Map<string, readonly StoredReading[]> {
  const held = new Map<string, readonly StoredReading[]>();
  if (section === undefined) return held;
  let value: Section;
  try {
    value = JSON.parse(Buffer.from(section).toString('utf8')) as Section;
  } catch {
    return held;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return held;
  for (const [row, count] of (value.counts ?? []).entries()) {
    const test = index?.tests[row];
    if (count > 0 && test !== undefined) held.set(test.id, [{ count, ...stop(test) }]);
  }
  for (const [id, readings] of Object.entries(value.cases ?? {})) held.set(id, readings);
  return held;
}
