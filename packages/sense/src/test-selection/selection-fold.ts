/**
 * What every runner seam does with the journals its run left behind.
 *
 * The recording half differs per runner — a Vite plugin, an Rspack loader, a
 * Jest transformer — and so does the hook that says the run is over. What
 * happens between those two is the same everywhere: read the journals, count
 * the crossings, ask each finished file whether its outcome may be trusted,
 * merge one layer into the index under its lock, and write the per-case
 * artifact beside it if the run was asked for one.
 *
 * A seam is then its runner's vocabulary and nothing else.
 */

import { rm } from 'node:fs/promises';
import { instrumentationId, type ModuleId } from '../instrument/index.js';
import { nameModules } from '../module-names.js';
import { commitOf } from './commit.js';
import { layeredCoverage } from './format-layer.js';
import {
  codeUnitOrder,
  crossingsOf,
  loadedOf,
  moduleNamesFile,
  projectPath,
  readRecords,
  type CapturedModule,
  type ReadJournal,
} from './instrumented-modules.js';
import { coverageModule } from './coverage-rows.js';
import { writeCaseIndex } from './case-fold.js';
import {
  coverageTest,
  noteAnEmptyRecord,
  oneRowPerFile,
  readJournals,
  type FinishedFile,
} from './finished-files.js';
import { noteABusyIndex, withIndexLock } from './index-lock.js';
import type { SelectionRun } from './selection-run.js';
import { governingPreconditions } from './governing-config.js';
import {
  seedTestCoverage,
  writeCoverageBytes,
  type CoverageModule,
  type TestCoverage,
} from './index.js';

/** Where a fold writes, and which of this seam's own files it clears up after. */
export interface FoldDestination {
  /** The snapshot this run layers onto. */
  readonly coverageFile: string;
  /** Where the per-case execution index goes, when the run recorded one. */
  readonly executionFile: string;
  /**
   * Modules this seam generated for this run.
   *
   * Nothing reads them once the journals are folded, and leaving them would
   * grow a directory in the user's project by a file or two a run — including
   * after a run that refuses, which is why they come off in a `finally` rather
   * than at the happy end.
   */
  readonly shims: readonly string[];
  /**
   * Where transforms in other processes wrote what their probes mean, for a
   * run whose {@link SelectionRun.modules} nobody in this process filled.
   *
   * A journal that names a module no store answers for is a file whose reach
   * is not known, so the file is recorded incomplete and the module left out,
   * as the Jest reporter does. Without stores that is a lost identity, and it
   * throws.
   */
  readonly stores?: readonly (string | readonly string[])[];
  /** What a run that placed no module should check first, when the seam knows better than the default. */
  readonly unreached?: string;
}

/**
 * The end of a run, as a function of which files finished and how.
 *
 * Idempotent: a runner that announces the end twice — two hooks of two major
 * versions both answered, a reporter installed on the root config and on a
 * project — folds once.
 */
export function foldRun(
  run: SelectionRun,
  destination: FoldDestination,
): (files: readonly FinishedFile[]) => Promise<void> {
  const { root, runDirectory, caseDirectory, modules, mode } = run;
  const { coverageFile, executionFile } = destination;

  const record = async (finished: readonly FinishedFile[]): Promise<void> => {
    // A worker wrote its journal down; a page handed its own to the runner,
    // which carried it here on the file.
    const written = [
      ...await readJournals(runDirectory),
      ...finished.flatMap((file) => (file.journal === undefined ? [] : [file.journal])),
    ];
    const { journals, unplaced } = destination.stores === undefined
      ? { journals: written, unplaced: new Set<string>() }
      : await placeFrom(destination.stores, written, modules, root, instrumentationId(mode));
    const files = finished.map((file) =>
      unplaced.has(projectPath(root, file.filepath)) ? { ...file, complete: false } : file);
    noteAnEmptyRecord(files.length, modules.size, destination.unreached);
    // A journal names modules by id, so nothing here re-keys paths; the id is
    // what the map is keyed by too.
    const rows = journals.map((journal) => ({
      testFile: projectPath(root, journal.testFile),
      modules: journal.modules,
    }));
    const observed = crossingsOf(rows);
    const early = loadedOf(rows);

    // One row per path, not per project run of it: two projects that both match
    // a file are two announcements of one test file, and the snapshot is keyed
    // by path.
    const tests = await Promise.all(
      oneRowPerFile(files, root).map((file) =>
        coverageTest(file, root, governingPreconditions(run, file.configs), journals, modules),
      ),
    );
    const commit = await commitOf(root);
    const current: TestCoverage = {
      version: 3,
      instrumentation: instrumentationId(mode),
      ...(commit === undefined ? {} : { commit }),
      tests: tests.sort((left, right) => codeUnitOrder(left.file, right.file)),
      modules: [...modules]
        .map(([id, module]): CoverageModule => coverageModule(
          module,
          (block) => [...(observed.get(id)?.get(block.ordinal) ?? [])],
          (block) => [...(early.get(id)?.get(block.ordinal) ?? [])],
        ))
        .sort((left, right) => codeUnitOrder(left.file, right.file)),
    };
    // The repository's snapshot becomes this checkout's before the first run
    // lands on it, so a worktree layers onto months of recording rather than
    // onto nothing. A no-op in the primary checkout and after the first run.
    await seedTestCoverage(coverageFile, root);
    // Both writes are read-modify-write over one index and both happen under one
    // lock, because a merge that landed while the numbering was still deciding
    // would describe modules the table had not agreed on yet.
    const merged = await withIndexLock(coverageFile, async (lock) => {
      await writeCoverageBytes(coverageFile, await layeredCoverage(coverageFile, current, root));
      // Everything this run saw, numbered for the next one. A file first met
      // today was instrumented under its path; from here on it has a number.
      await nameModules(
        moduleNamesFile(root),
        [...modules.values()].map((module) => module.file),
        lock,
      );
    });
    if (!merged.held) noteABusyIndex(coverageFile);
    // Beside the snapshot, never inside it. The snapshot answers *which files
    // must run*, and its readers are unchanged. A run whose files ran in a page
    // recorded no case, and an index with no case in it would answer *which
    // cases walk this line* with none.
    if (run.cases) {
      await writeCaseIndex(executionFile, caseDirectory, root, modules, {
        tests,
        ...(commit === undefined ? {} : { commit }),
      });
    }
    await rm(runDirectory, { recursive: true, force: true });
    await rm(caseDirectory, { recursive: true, force: true });
    await rm(run.finishedDirectory, { recursive: true, force: true });
  };

  return async (files: readonly FinishedFile[]): Promise<void> => {
    if (run.settled) return;
    run.settled = true;
    try {
      await record(files);
    } finally {
      for (const shim of destination.shims) await rm(shim, { force: true });
    }
  };
}

/**
 * The records every journal names, read into the run, and the files whose
 * journal named one no store answers for.
 *
 * Read by the ids the journals name and no others: a store keeps every module
 * any earlier run transformed, and the run is about the ones this run's files
 * went through.
 */
async function placeFrom(
  stores: readonly (string | readonly string[])[],
  journals: readonly ReadJournal[],
  modules: Map<ModuleId, CapturedModule>,
  root: string,
  instrumentation: string,
): Promise<{ journals: readonly ReadJournal[]; unplaced: ReadonlySet<string> }> {
  const read = await readRecords(
    stores,
    journals.flatMap((journal) => journal.modules.map((entered) => entered.id)),
    instrumentation,
  );
  for (const [id, module] of read) modules.set(id, module);
  const unplaced = new Set<string>();
  return {
    journals: journals.map((journal) => {
      const placed = journal.modules.filter((entered) => modules.has(entered.id));
      if (placed.length === journal.modules.length) return journal;
      unplaced.add(projectPath(root, journal.testFile));
      return { ...journal, modules: placed };
    }),
    unplaced,
  };
}
