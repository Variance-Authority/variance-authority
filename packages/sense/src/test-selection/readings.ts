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
 * A record holds one table per file, and it is the file's own cut: what the
 * file's text gives, whichever readings of it a run happened to load. Shards
 * of one build run different tests, so a table made of the readings they
 * loaded would differ by shard, and the shards would not fold. Every reading
 * lands on the file's cut by the addon's `landRegions` — at the region of its
 * shape, else at the innermost one enclosing it, else at the file — and every
 * journal row is read through that.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InstrumentMode, ModuleId } from '../instrument/index.js';
import { native, nativeRefusal } from '../addon.js';
import { captureModule, heldOriginal, pathOf } from './captured-modules.js';
import { codeUnitOrder, fileOrNone, type CapturedModule, type ReadJournal } from './instrumented-modules.js';
import { isWritten } from './written-lines.js';

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
  /** Every reading of a file that is not the file's one reading of itself, by the id its probes report under. */
  readonly readings: ReadonlyMap<ModuleId, Reading>;
}

/** A file's own cut, by its repository-relative path; `undefined` where the file is not there to cut. */
export type OwnCut = (file: string) => CapturedModule | undefined;

/**
 * Each file's readings as one record.
 *
 * A file the run read once, as itself — the id its probes report names the
 * file — is that reading. Any other is held under its own cut, which `cut`
 * makes, and each of its readings lands on that. When a reading went
 * uninstrumented the file is: what that reading ran is unknown, and so is the
 * record's. So is a file `cut` cannot cut, or one whose text on disk is not the
 * text a reading was cut from.
 *
 * A region the transform wrote without an origin has no place in the file to
 * land at, and no line of the file selects it; it is in no record.
 */
export function joinReadings(modules: ReadonlyMap<ModuleId, CapturedModule>, cut: OwnCut): JoinedReadings {
  const byFile = new Map<string, ModuleId[]>();
  for (const [id, module] of modules) byFile.set(module.file, [...byFile.get(module.file) ?? [], id]);
  const joined = new Map<ModuleId, CapturedModule>();
  const readings = new Map<ModuleId, Reading>();
  for (const [file, ids] of byFile) {
    if (ids.length === 1 && pathOf(ids[0]!) === file) {
      joined.set(ids[0]!, modules.get(ids[0]!)!);
      continue;
    }
    ids.sort(codeUnitOrder);
    const read = ids.map((each) => modules.get(each)!);
    const own = cut(file);
    const fits = (module: CapturedModule) => module.instrumented && module.sourceDigest === own?.sourceDigest;
    if (own === undefined || !own.instrumented || !read.every(fits)) {
      const id = own?.id ?? ids[0]!;
      joined.set(id, { file, id, sourceDigest: own?.sourceDigest ?? read[0]!.sourceDigest, instrumented: false, blocks: [] });
      for (const each of ids) readings.set(each, { id, lands: [] });
      continue;
    }
    joined.set(own.id, own);
    const table = own.blocks.filter(isWritten);
    const placed = read.map((module) => module.blocks.filter(isWritten));
    const lands = landed(table, placed);
    for (const [at, each] of ids.entries()) {
      const ordinals: (number | undefined)[] = [];
      for (const [index, block] of placed[at]!.entries()) {
        const place = lands[at]![index];
        ordinals[block.ordinal] = place == null ? undefined : table[place]!.ordinal;
      }
      readings.set(each, { id: own.id, lands: ordinals });
    }
  }
  return { modules: joined, readings };
}

type Placed = CapturedModule['blocks'][number] & { readonly startLine: number; readonly endLine: number };

/** Where each of `placed`'s regions is among `table`'s, by position, from the addon. */
function landed(table: readonly Placed[], placed: readonly (readonly Placed[])[]): readonly (readonly (number | null)[])[] {
  const land = native()?.landRegions;
  if (land === undefined) {
    throw new Error(`joining one file's readings requires the Sense native addon: ${nativeRefusal() ?? 'the loaded addon has no `landRegions`'}`);
  }
  const shape = (blocks: readonly Placed[]) =>
    blocks.map(({ kind, name, path, startLine, endLine, source }) => ({ kind, name, path, startLine, endLine, source }));
  return land(shape(table), placed.map(shape));
}

/**
 * Each file's own cut, as the transform that probes it ahead of every other
 * one cuts it: from its text on disk under `root`.
 */
export function ownCut(root: string, mode: InstrumentMode | undefined): OwnCut {
  return (file) => {
    const path = resolve(root, file);
    const disk = fileOrNone(path, (at) => readFileSync(at, 'utf8'));
    return disk === undefined ? undefined : captureModule(root, path, disk, () => true, mode, heldOriginal(path, disk))?.module;
  };
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
