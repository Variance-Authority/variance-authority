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

import { rm, writeFile } from 'node:fs/promises';
import { instrumentationId } from '../instrument/index.js';
import { nameModules } from '../module-names.js';
import { commitOf } from './commit.js';
import { layeredCoverage } from './format-layer.js';
import {
  codeUnitOrder,
  crossingsOf,
  loadedOf,
  moduleNamesFile,
  projectPath,
} from './instrumented-modules.js';
import { coverageModule } from './coverage-rows.js';
import { executionIndexFrom, readCaseJournals } from './cases.js';
import { executionIndexBytes } from './execution-format.js';
import {
  coverageTest,
  noteAnEmptyRecord,
  oneRowPerFile,
  readJournals,
  type FinishedFile,
} from './finished-files.js';
import { noteABusyIndex, withIndexLock } from './index-lock.js';
import type { SelectionRun } from './selection-run.js';
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

  const record = async (files: readonly FinishedFile[]): Promise<void> => {
    noteAnEmptyRecord(files.length, modules.size);
    const journals = await readJournals(runDirectory);
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
        coverageTest(file, root, [...run.preconditions], journals, modules),
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
    // must run*, its readers are unchanged, and a run that records cases writes
    // the same bytes there as one that does not.
    if (run.cases) {
      const caseJournals = await readCaseJournals(caseDirectory, root);
      await writeFile(
        executionFile,
        executionIndexBytes(executionFile, executionIndexFrom(caseJournals, modules)),
      );
    }
    await rm(runDirectory, { recursive: true, force: true });
    await rm(caseDirectory, { recursive: true, force: true });
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
