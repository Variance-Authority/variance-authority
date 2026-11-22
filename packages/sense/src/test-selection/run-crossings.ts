/**
 * The crossings of one run, as every runner seam reads them once its last file
 * has finished: which test files crossed each region of each module, which did
 * so while loading, and which modules each journal entered.
 *
 * The fold is the addon's `run_crossings.rs`, read straight off the bytes the
 * workers wrote; here is only how a seam looks an answer up. A journal is never
 * decoded into rows on the way, because a suite of fourteen thousand files is
 * millions of them (#1748).
 */

import { native } from '../addon.js';
import type { ModuleId } from '../instrument/index.js';
import type { NativeCarriedJournal, NativeRunCrossings } from '../native-run-crossings.js';
import type { CapturedModule, ReadJournal } from './instrumented-modules.js';
import type { Reading } from './readings.js';
import { whyAbsent } from './native-modules.js';

/** One journal of the run: the file that wrote it, and the modules it entered. */
export interface RunJournal {
  /** Its place among the journals given: the workers' first, then the pages'. */
  readonly index: number;
  /** The test file, by its project path. */
  readonly test: string;
  /** Each module it entered, by its number among {@link RunCrossings.ids}. */
  readonly modules: Uint32Array;
  /** When the file finished collecting, by the worker's `Date.now()`; absent where nothing marked it. */
  readonly collected?: number;
  /** False when it named a module the run could not place, which the fold left out. */
  readonly placed: boolean;
}

export interface RunCrossings {
  /** Each module a placed row named, by its id after any reading. */
  readonly ids: readonly ModuleId[];
  /** The test files that crossed `ordinal` of module `id`, in code-unit order. */
  observed(id: ModuleId, ordinal: number): readonly string[];
  /** The test files that crossed it before their first test, in code-unit order. */
  early(id: ModuleId, ordinal: number): readonly string[];
  /** Every journal, in the order given. */
  readonly journals: readonly RunJournal[];
  /** The journals of one test file, by its project path; none when it left none. */
  journalsOf(test: string): readonly RunJournal[];
  /** `modules` by module number, aligned with {@link ids}. */
  numbered(modules: ReadonlyMap<ModuleId, CapturedModule>): readonly (CapturedModule | undefined)[];
}

/** Every module id the journals name, each once, in the order first named. */
export function runModuleIds(journals: readonly Buffer[], pages: readonly ReadJournal[]): readonly ModuleId[] {
  return addon().runModuleIds!([...journals], carried(pages));
}

/**
 * The run's journals — the workers' `journals`, then the pages' — folded under
 * the checkout at `root`, each row read in its file's record through
 * `readings`. A row of a module outside `placed` is left out, and its journal
 * says so.
 */
export function runCrossings(
  journals: readonly Buffer[],
  pages: readonly ReadJournal[],
  root: string,
  readings: ReadonlyMap<ModuleId, Reading>,
  placed: Iterable<ModuleId>,
): RunCrossings {
  const said = addon().runCrossings!(
    [...journals],
    carried(pages),
    root,
    [...readings].map(([id, reading]) => ({ id, target: reading.id, lands: Array.from(reading.lands, (land) => land ?? 0xFFFF_FFFF) })),
    [...placed],
  );
  return read(said);
}

function read(said: NativeRunCrossings): RunCrossings {
  const { tests, ids } = said;
  const unplaced = new Set(said.unplaced);
  const journals: RunJournal[] = [];
  for (let at = 0, index = 0; at < said.journals.length; index += 1) {
    const count = said.journals[at + 1]!;
    const collected = said.collected[index]!;
    journals.push({
      index,
      test: tests[said.journals[at]!]!,
      modules: said.journals.subarray(at + 2, at + 2 + count),
      ...(collected === 0 ? {} : { collected }),
      placed: !unplaced.has(index),
    });
    at += 2 + count;
  }
  const byTest = new Map<string, RunJournal[]>();
  for (const journal of journals) byTest.set(journal.test, [...byTest.get(journal.test) ?? [], journal]);
  return {
    ids,
    observed: lookup(said.hits, ids, tests),
    early: lookup(said.loaded, ids, tests),
    journals,
    journalsOf: (test) => byTest.get(test) ?? [],
    numbered: (modules) => ids.map((id) => modules.get(id)),
  };
}

/**
 * One column read by module and ordinal. Each module's ordinals are indexed the
 * first time one is asked, since a record asks every module once.
 */
function lookup(column: Uint32Array, ids: readonly ModuleId[], tests: readonly string[]): (id: ModuleId, ordinal: number) => readonly string[] {
  const starts = new Map<ModuleId, number>();
  for (let at = 0, module = 0; module < ids.length; module += 1) {
    starts.set(ids[module]!, at);
    let count = column[at]!;
    at += 1;
    while (count-- > 0) at += 2 + column[at + 1]!;
  }
  const indexed = new Map<ModuleId, ReadonlyMap<number, number>>();
  return (id, ordinal) => {
    const start = starts.get(id);
    if (start === undefined) return [];
    let ordinals = indexed.get(id);
    if (ordinals === undefined) {
      const found = new Map<number, number>();
      for (let at = start + 1, count = column[start]!; count > 0; count -= 1) {
        found.set(column[at]!, at + 1);
        at += 2 + column[at + 1]!;
      }
      indexed.set(id, ordinals = found);
    }
    const at = ordinals.get(ordinal);
    if (at === undefined) return [];
    return Array.from(column.subarray(at + 1, at + 1 + column[at]!), (test) => tests[test]!);
  };
}

function carried(pages: readonly ReadJournal[]): NativeCarriedJournal[] {
  return pages.map((page) => ({
    testFile: page.testFile,
    modules: page.modules.map(({ id, hits, shared, loaded }) => ({ id, hits, shared, loaded })),
  }));
}

function addon() {
  const loaded = native();
  if (loaded?.runCrossings === undefined) throw new Error(`folding a run's crossings requires the Sense native addon: ${whyAbsent('runCrossings')}`);
  if (loaded.runModuleIds === undefined) throw new Error(`folding a run's crossings requires the Sense native addon: ${whyAbsent('runModuleIds')}`);
  return loaded;
}
