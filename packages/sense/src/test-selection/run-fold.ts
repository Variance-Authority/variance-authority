import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ModuleId } from '../instrument/index.js';
import { openCrossingSets, type CrossingSetsView } from './crossing-sets-read.js';
import { foldCrossings, scanJournal, type JournalVisitor } from './crossing-fold.js';
import { codeUnitOrder, isMissing, type CapturedModule } from './instrumented-modules.js';

/**
 * A run's journals read as columns, which is the only way a large repository's
 * are readable at all.
 *
 * The shipped path used to be `readJournals` then `crossingsOf`: every frame of
 * the run as rows, and then a `Map<ModuleId, Map<ordinal, Set<string>>>` holding
 * one entry per region a test entered. Both are the run's whole crossing count,
 * and that count is the product of two axes a repository grows independently —
 * measured on two hundred thousand modules at eight regions each, thirty-one
 * test files of a forty-thousand-module shape cost two and a half gigabytes and
 * five hundred exhausted a twelve-gigabyte heap.
 *
 * Here the frames stay on disk and are read again per slice of the modules, and
 * what comes back is a set id per region against a pool of the distinct sets.
 * The same fixture folds its whole two thousand test files — a hundred and three
 * million module rows, eight hundred and twenty-six million crossings — inside
 * four hundred and fifty megabytes.
 */
export interface RunFold {
  /** The test files the run's frames named, in the order the fold numbered them. */
  readonly tests: readonly string[];
  /** How many times the frames were read: the slice count the budget implied. */
  readonly passes: number;
  /**
   * Modules a test entered whose text the instrument could not see inside.
   *
   * These are its preconditions. An instrumented module is not one: its digest
   * is on its own row and a change to its text is caught by re-cutting its
   * regions, where recording it again under every test that reached it is the
   * same fact written once per module-test pair.
   */
  uninstrumented(test: string): readonly ModuleId[];
  /** The test files that entered a region, in code-unit order. */
  crossers(id: ModuleId, ordinal: number): readonly string[];
  /** The same, for what had been entered before the file's first test ran. */
  loadedBy(id: ModuleId, ordinal: number): readonly string[];
}

export interface RunFoldInput {
  /** Where the run's workers dropped their frames. Missing counts as none. */
  readonly directory: string;
  /** What a frame's test file is called in the snapshot. */
  readonly name: (testFile: string) => string;
  /** The modules this run has records for. A frame naming any other is dropped. */
  readonly modules: ReadonlyMap<ModuleId, CapturedModule>;
  /** What one slice may hold. `crossing-fold.ts` states the default. */
  readonly budget?: number;
}

/** Every frame in a run directory, in a stable order. */
export async function runJournals(directory: string): Promise<readonly string[]> {
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return [...names].sort().map((name) => resolve(directory, name));
}

/** The test file each frame belongs to, which is the fold's numbering. */
export function testsOfJournals(paths: readonly string[], name: (file: string) => string): string[] {
  const held = new Set<string>();
  for (const path of paths) {
    // Only the frame's header is wanted, so every module row is refused.
    scanJournal(readFileSync(path), {
      test(file) { held.add(name(file)); },
      wants() { return false; },
      module() { /* refused above */ },
    });
  }
  return [...held].sort(codeUnitOrder);
}

export function foldRun(input: RunFoldInput, paths: readonly string[], tests: readonly string[]): RunFold {
  const { modules, name } = input;
  const testId = new Map(tests.map((file, at) => [file, at]));

  // Rows in whatever order the module map is in: the fold answers by id and
  // ordinal, so nothing here depends on the order being the snapshot's.
  const rowOf = new Map<ModuleId, number>();
  const moduleBlocks = new Uint32Array(modules.size + 1);
  let row = 0;
  for (const [id, module] of modules) {
    rowOf.set(id, row);
    let span = 0;
    for (const block of module.blocks) if (block.ordinal + 1 > span) span = block.ordinal + 1;
    moduleBlocks[row + 1] = moduleBlocks[row]! + span;
    row += 1;
  }

  // The preconditions, taken off the first pass rather than a pass of their own.
  // A module with no regions is the exception, so these lists are short where
  // the crossings are the repository.
  const uninstrumented = new Map<string, ModuleId[]>();
  let first = true;
  let test = '';

  const folded = foldCrossings({
    rowOf: (id) => rowOf.get(id),
    moduleBlocks,
    testId,
    ...(input.budget === undefined ? {} : { budget: input.budget }),
    replay(visit: JournalVisitor) {
      const noted: JournalVisitor = {
        test(file) { test = file; visit.test(file); },
        wants(id) {
          if (first) {
            const module = modules.get(id);
            if (module !== undefined && !module.instrumented) {
              const at = name(test);
              let held = uninstrumented.get(at);
              if (held === undefined) uninstrumented.set(at, held = []);
              held.push(id);
            }
          }
          return visit.wants === undefined ? true : visit.wants(id);
        },
        module(id, hits, shared, loaded) { visit.module(id, hits, shared, loaded); },
      };
      for (const path of paths) scanJournal(readFileSync(path), noted);
      first = false;
    },
  });

  const enteredView = openCrossingSets(folded.enteredSets.pool());
  const loadedView = openCrossingSets(folded.loadedSets.pool());
  const namesOf = (
    view: CrossingSetsView,
    column: Uint32Array,
    id: ModuleId,
    ordinal: number,
  ): readonly string[] => {
    const at = rowOf.get(id);
    if (at === undefined) return [];
    const base = moduleBlocks[at]!;
    if (ordinal < 0 || ordinal >= moduleBlocks[at + 1]! - base) return [];
    const members = view.members(column[base + ordinal]!);
    // Ascending test rows are ascending test paths, because the numbering is the
    // sort: what comes back is already in the order a block stores it in.
    const held: string[] = [];
    for (const member of members) held.push(tests[member]!);
    return held;
  };

  return {
    tests,
    passes: folded.passes,
    uninstrumented: (file) => uninstrumented.get(file) ?? [],
    crossers: (id, ordinal) => namesOf(enteredView, folded.entered, id, ordinal),
    loadedBy: (id, ordinal) => namesOf(loadedView, folded.loaded, id, ordinal),
  };
}
