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
import { commitOf } from './commit.js';
import { landRun } from './commit-runs.js';
import {
  codeUnitOrder,
  crossingsOf,
  loadedOf,
  projectPath,
  readRecords,
  type CapturedModule,
  type ReadJournal,
} from './instrumented-modules.js';
import { coverageModule } from './coverage-rows.js';
import { writeCaseIndex } from './case-fold.js';
import { caseDurations } from './case-durations.js';
import {
  coverageTest,
  noteAnEmptyRecord,
  oneRowPerFile,
  readJournals,
  type FinishedFile,
} from './finished-files.js';
import { noteABusyIndex, withIndexLock } from './index-lock.js';
import { removeSeamModules, type SelectionRun } from './selection-run.js';
import { governingPreconditions } from './governing-config.js';
import { cacheRootFor, markCheckout } from './cache-layers.js';
import { prunedLine, pruneWhenDue } from './prune.js';
import { repositoryRoot } from './repository-root.js';
import {
  noteSeeded,
  seedTestCoverage,
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
   * Nothing reads them once the last run is folded, and leaving them would
   * grow a directory in the user's project by a file or two a run — including
   * after a run that refuses, which is why they come off in a `finally` rather
   * than at the happy end. A watching runner's last run is the one before it
   * closes, so its seam takes them off at the close instead.
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
 * project — folds once. A watching runner folds every rerun, because its seam
 * calls `reopenRun` when one starts.
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
    // FIXME: each test file reads and digests its preconditions itself, so one
    // that every test shares is read once per test file. This repository's unit
    // suite declares every file of the native crate, which made re-reading them
    // about 2.5 s of a fold that needs to read each of them once.
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
    noteSeeded(await seedTestCoverage(coverageFile, root));
    const merged = await withIndexLock(coverageFile, async () => {
      await landRun(coverageFile, current, root);
      markCheckout(repositoryRoot(root));
    });
    // A run that placed no module says so once the snapshot saying every file
    // may be skipped is written. A run the lock refused wrote none, and the busy
    // warning is the whole story.
    if (merged.held) noteAnEmptyRecord(files.length, modules.size, destination.unreached);
    else noteABusyIndex(coverageFile);
    // Beside the snapshot, never inside it. The snapshot answers *which files
    // must run*, and its readers are unchanged. `run.cases` is whether the run
    // could record a case: one whose files ran in a page could not. One that
    // could, and recorded no case and finished no file — no worker loaded this
    // seam's modules — is declined by the writer, which leaves the index there
    // as it was. A run the snapshot did not take lays no cases either, or the
    // index would answer for a run the snapshot beside it never saw.
    if (run.cases && merged.held) {
      await writeCaseIndex(executionFile, caseDirectory, root, modules, {
        tests,
        ...(commit === undefined ? {} : { commit }),
        durations: caseDurations(files, root),
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
      // A watching runner loads them again for every rerun; its close takes them off.
      if (!run.watching) removeSeamModules(run, destination.shims);
    }
    // After the lock is released, and at most once a day: see `prune.ts`.
    const pruned = prunedLine(await pruneWhenDue(cacheRootFor(repositoryRoot(root))));
    if (pruned !== '') console.warn(pruned);
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
