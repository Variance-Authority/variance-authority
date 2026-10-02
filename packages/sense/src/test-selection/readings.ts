/**
 * One file's readings, joined into the one record a file has.
 *
 * A run can load one source file twice: a package's own tests import
 * `src/cart.ts`, and another package's tests reach it through the manifest as
 * `dist/cart.js`, whose map leads back to the source. Each load is a reading —
 * the module as one transform delivered it, cut into regions from that
 * transform's text — and both are named after the file. Their probes report
 * under ids of their own, because an ordinal means a region only in the table
 * of the reading that cut it.
 *
 * A record holds one table per file, so a fold reads the readings at the
 * regions they all hold, by the same rule that joins one file's tables across
 * shards (`reconcileRegions`), and reads every journal row through the table
 * its reading cut.
 */

import type { ModuleId } from '../instrument/index.js';
import { reconcileRegions, type RegionShape } from './execution-merge.js';
import { codeUnitOrder, type CapturedModule, type ReadJournal } from './instrumented-modules.js';
import { isWritten } from './written-lines.js';
import type { CoverageBlock } from './index.js';

/** Where one reading's ordinals are in its file's record. */
export interface Reading {
  /** The id the record of the file is held under. */
  readonly id: ModuleId;
  /** The record's ordinal for each of this reading's ordinals; absent for a region with no place in the file. */
  readonly lands: readonly (number | undefined)[];
}

export interface JoinedReadings {
  /** One record per file. */
  readonly modules: ReadonlyMap<ModuleId, CapturedModule>;
  /** Every reading of a file read more than once, by the id its probes report under. */
  readonly readings: ReadonlyMap<ModuleId, Reading>;
}

type Placed = CoverageBlock & { readonly startLine: number; readonly endLine: number };

/**
 * Each file's readings as one record.
 *
 * A file read once is its reading. A file read more than once is held under
 * the reading that is the file itself when the run loaded it, and otherwise
 * under the first id in code-unit order. When any reading went uninstrumented
 * the file is: what that reading ran is unknown, and so is the record's.
 *
 * A region the transform wrote without an origin has no place in the file to
 * be joined at, and no line of the file selects it; it is in no joined record.
 */
export function joinReadings(modules: ReadonlyMap<ModuleId, CapturedModule>): JoinedReadings {
  const byFile = new Map<string, ModuleId[]>();
  for (const [id, module] of modules) byFile.set(module.file, [...byFile.get(module.file) ?? [], id]);
  const joined = new Map<ModuleId, CapturedModule>();
  const readings = new Map<ModuleId, Reading>();
  for (const [file, ids] of byFile) {
    if (ids.length === 1) {
      joined.set(ids[0]!, modules.get(ids[0]!)!);
      continue;
    }
    ids.sort(codeUnitOrder);
    const id = ids.includes(file) ? file : ids[0]!;
    const read = ids.map((each) => modules.get(each)!);
    const { sourceDigest } = modules.get(id)!;
    if (read.some((module) => !module.instrumented)) {
      joined.set(id, { file, id, sourceDigest, instrumented: false, blocks: [] });
      for (const each of ids) readings.set(each, { id, lands: [] });
      continue;
    }
    const placed = read.map((module) => module.blocks.filter(isWritten));
    const whole = (shape: RegionShape): Placed => ({ ...shape, kind: 'module', ordinal: 0, digest: sourceDigest, testFiles: [] });
    const { blocks, lands } = reconcileRegions<Placed>(placed, whole);
    const { record, from } = rooted(blocks, placed);
    joined.set(id, { file, id, sourceDigest, instrumented: true, blocks: record });
    for (const [at, each] of ids.entries()) {
      const own: (number | undefined)[] = [];
      for (const [index, block] of placed[at]!.entries()) own[block.ordinal] = from[lands[at]![index]!];
      readings.set(each, { id, lands: own });
    }
  }
  return { modules: joined, readings };
}

/**
 * The joined blocks as a record: the module first, every block numbered by its
 * place and owned by its nearest owner the record kept, and by the module when
 * it kept none.
 *
 * A kept block is one inventory's own object, and its owners are that
 * inventory's, which come before it. The module is the base's when every
 * reading cut it alike, and otherwise the region the join cut spanning the
 * file. The join always cut one then: a reading's module holds every region
 * that reading cut, so a shared region holding it spans the module's lines in
 * every reading, and two modules on the same lines are the same region. `from`
 * is each joined block's place in the record.
 */
function rooted(
  blocks: readonly Placed[],
  inventories: readonly (readonly Placed[])[],
): { readonly record: CoverageBlock[]; readonly from: readonly number[] } {
  const ownersOf = new Map<Placed, ReadonlyMap<number, Placed>>();
  for (const inventory of inventories) {
    const byOrdinal = new Map(inventory.map((block) => [block.ordinal, block]));
    for (const block of inventory) ownersOf.set(block, byOrdinal);
  }
  const first = blocks[0];
  const kept = first !== undefined && first.kind === 'module' && first.owner === undefined && ownersOf.has(first);
  const root = kept ? first : blocks.find((block) => !ownersOf.has(block))!;
  const ordered = [root, ...blocks.filter((block) => block !== root)];
  const at = new Map<Placed, number>(ordered.map((block, index) => [block, index]));
  const from = blocks.map((block) => at.get(block)!);
  const record = ordered.map((block, index): CoverageBlock => {
    const { owner: _owner, ...rest } = block;
    if (index === 0) return { ...rest, ordinal: 0 };
    const byOrdinal = ownersOf.get(block)!;
    let up = block.owner === undefined ? undefined : byOrdinal.get(block.owner);
    while (up !== undefined && !at.has(up)) up = up.owner === undefined ? undefined : byOrdinal.get(up.owner);
    return { ...rest, ordinal: index, owner: up === undefined ? 0 : at.get(up)! };
  });
  return { record, from };
}

/**
 * Every journal row read in its file's record: the ordinals of a joined reading
 * become the record's, and two readings one file loaded become one row.
 *
 * An ordinal entered while the module evaluated in either reading stays so:
 * it credits every file that consumed the module, which may credit more than ran
 * it and never fewer.
 */
export function joinedJournals(
  journals: readonly ReadJournal[],
  readings: ReadonlyMap<ModuleId, Reading>,
): ReadJournal[] {
  if (readings.size === 0) return [...journals];
  return journals.map((journal) => {
    const rows = new Map<ModuleId, { hits: Set<number>; shared: Set<number>; loaded: Set<number> }>();
    for (const module of journal.modules) {
      const reading = readings.get(module.id);
      const id = reading?.id ?? module.id;
      const row = rows.get(id) ?? { hits: new Set(), shared: new Set(), loaded: new Set() };
      for (const [into, ordinals] of [
        [row.hits, module.hits],
        [row.shared, module.shared],
        [row.loaded, module.loaded],
      ] as const) {
        for (const ordinal of ordinals) {
          const landed = reading === undefined ? ordinal : reading.lands[ordinal];
          if (landed !== undefined) into.add(landed);
        }
      }
      rows.set(id, row);
    }
    const ascending = (ordinals: Set<number>): number[] => [...ordinals].sort((left, right) => left - right);
    return {
      ...journal,
      modules: [...rows].map(([id, row]) => ({
        id,
        hits: ascending(row.hits),
        shared: ascending(row.shared),
        loaded: ascending(row.loaded),
      })),
    };
  });
}
