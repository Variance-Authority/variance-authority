/**
 * The earlier readings of a case over the code its newest reading read, kept
 * so a reader can set one reading against another (spec 0072 item 2).
 *
 * A **reading** is one recorded run of one case: whether it stopped, and each
 * region it crossed with the value its cadence charged there (`case-lines.ts`),
 * or none for a case recorded without cuts. A rerun replaces the case in the
 * index; before it does, the reading it replaces is kept here when every module
 * either reading entered was recorded from the same text in both. A module that
 * differs, or that only one side recorded, drops every earlier reading of the
 * case: they read other code.
 *
 * A reading equal to one already kept is not stored again: its count goes up.
 * So a case that reads the same every time costs its count, and only a case
 * whose readings differ costs regions. The newest reading is the one the index
 * holds, and is stored here as its count and stop alone, unless the index
 * holds the case otherwise. At most
 * {@link READINGS} distinct readings are kept, the oldest dropped first: the
 * bound a story keeps (ADR-0079).
 *
 * The section is JSON: a reader that does not ask for readings never decodes it,
 * and selection never does.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { linesOf, valueAt } from './case-lines.js';
import { openSetExecutionIndex, type OpenedSetExecutionIndex } from './execution-set-format.js';
import { EMPTY } from './set-translation.js';

/** Distinct readings kept per case, newest first: the bound a story keeps. */
export const READINGS = 16;

/** One region a reading crossed: its module, its declaration's name and the path in it, its lines, and the value cadence charged it; null where no line was recorded. */
export type ReadRegion = readonly [module: string, name: string, path: string, startLine: number, endLine: number, value: number | null];

/** One reading of a case, and how many runs read it so. */
export interface Reading {
  readonly count: number;
  /** As the case's own `stopped` says it: absent when the producer could not see how it settled. */
  readonly stopped?: boolean;
  /** Every region it crossed, in module and region order. */
  readonly regions: readonly ReadRegion[];
}

/** How the section stores a case: the newest reading's regions are the index's, so it holds none. */
interface StoredCase {
  readonly modules: readonly string[];
  readonly readings: readonly (Omit<Reading, 'regions'> & { readonly regions?: readonly ReadRegion[] })[];
}

type Stored = Readonly<Record<string, StoredCase>>;

/** What a case's reading is, read off an index. */
interface Read {
  readonly stopped?: boolean;
  readonly regions: ReadRegion[];
  readonly modules: Set<string>;
}

/**
 * The readings section once a run is laid: `kept` is the section the record
 * held, `previous` the index the run is laid over, `fresh` the run's own index,
 * `landed` the index the record will hold, and `cases` every case it holds.
 * `same` says whether the run recorded `file` from the text `previous` holds it
 * at.
 *
 * The newest reading of a case is stored without its regions only where the
 * landed index holds the case as that reading ran. A file the run did not
 * finish is laid over, its earlier crossings kept beside the new ones
 * (`case-layer.ts`), and an index cut to what a share collected holds less; a
 * case of either keeps its newest reading's regions here.
 *
 * Absent when no case holds a reading the index does not: absent is not empty.
 */
export function layReadings(
  kept: Uint8Array | undefined,
  previous: Uint8Array | undefined,
  fresh: Uint8Array | undefined,
  landed: Uint8Array | undefined,
  cases: ReadonlySet<string>,
  same: (file: string) => boolean,
): Buffer | undefined {
  const held = parsed(kept);
  const run = fresh === undefined ? undefined : openSetExecutionIndex(fresh);
  if (fresh !== undefined && run === undefined) throw new Error('a case fold wrote an index it cannot open');
  const recorded = run?.modules.map((module) => module.file) ?? [];
  const ran = new Set(run?.tests.map((test) => test.id));
  const before = previous === undefined ? undefined : openSetExecutionIndex(previous);
  const earlier = before === undefined ? new Map<string, Read>() : readsOf(before, new Set([...ran, ...Object.keys(held)]));
  const now = run === undefined ? new Map<string, Read>() : readsOf(run, ran);
  const opened = landed === undefined ? undefined : openSetExecutionIndex(landed);
  const there = opened === undefined ? new Map<string, Read>() : readsOf(opened, new Set([...ran, ...Object.keys(held)]));
  const laid: Record<string, StoredCase> = {};
  // A case the run did not record keeps its readings while the code they read
  // stands: a module the run recorded at another text drops them.
  for (const [id, stored] of Object.entries(held)) {
    if (ran.has(id) || !cases.has(id)) continue;
    if (recorded.some((file) => stored.modules.includes(file) && !same(file))) continue;
    const [newest, ...rest] = stored.readings;
    const regions = newest!.regions ?? earlier.get(id)?.regions ?? [];
    laid[id] = { modules: stored.modules, readings: [lain({ ...newest!, regions }, there.get(id)), ...rest] };
  }
  for (const [id, reading] of now) {
    const stored = held[id];
    const was = earlier.get(id);
    const newest = stored?.readings[0];
    const wasRegions = newest?.regions ?? was?.regions;
    const modules = new Set([...reading.modules, ...(wasRegions === undefined ? [] : [...stored?.modules ?? [], ...was?.modules ?? [], ...wasRegions.map(([file]) => file)])]);
    const readings: Reading[] = wasRegions === undefined || ![...modules].every(same) ? [] : [
      { ...(newest ?? { count: 1 }), ...stop(newest ?? was!), regions: wasRegions },
      ...(stored?.readings.slice(1) ?? []) as Reading[],
    ];
    if (readings.length === 0) modules.clear();
    for (const file of reading.modules) modules.add(file);
    const at = readings.findIndex((one) => alike(one, reading));
    const [found] = at === -1 ? [] : readings.splice(at, 1);
    const first = found === undefined
      ? { count: 1, ...stop(reading), regions: reading.regions }
      : { ...found, count: found.count + 1 };
    const kept = [first, ...readings].slice(0, READINGS);
    if (kept.length === 1 && first.count === 1 && alike(first, there.get(id))) continue;
    laid[id] = {
      modules: [...modules].sort(codeUnitOrder),
      readings: [lain(kept[0]!, there.get(id)), ...kept.slice(1)],
    };
  }
  const ids = Object.keys(laid).sort(codeUnitOrder);
  if (ids.length === 0) return undefined;
  return Buffer.from(JSON.stringify(Object.fromEntries(ids.map((id) => [id, laid[id]]))), 'utf8');
}

/** The newest reading as stored: without its regions where the landed index holds them as they ran. */
function lain(reading: Reading, there: Read | undefined): StoredCase['readings'][number] {
  return alike(reading, there) ? { count: reading.count, ...stop(reading) } : reading;
}

/**
 * Every reading the record keeps of case `id`, newest first, the newest read
 * off `index`; absent when the record keeps no earlier reading of it.
 */
export function readingsOf(section: Uint8Array | undefined, index: Uint8Array | undefined, id: string): readonly Reading[] | undefined {
  const stored = parsed(section)[id];
  if (stored === undefined) return undefined;
  const opened = index === undefined || stored.readings[0]?.regions !== undefined ? undefined : openSetExecutionIndex(index);
  const newest = opened === undefined ? undefined : readsOf(opened, new Set([id])).get(id)?.regions;
  return stored.readings.map((reading) => ({ ...reading, regions: reading.regions ?? newest ?? [] }));
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

function parsed(section: Uint8Array | undefined): Stored {
  if (section === undefined) return {};
  try {
    const value = JSON.parse(Buffer.from(section).toString('utf8')) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Stored : {};
  } catch {
    return {};
  }
}
