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
import { codeUnitOrder } from '@variance-authority/core/segment';
import { instrumentationId } from '../instrument/index.js';
import { runTexts } from '../text-digests.js';
import { deriveModules } from './captured-modules.js';
import { commitOf } from './commit.js';
import { laidProbes, landRun } from './commit-runs.js';
import { projectPath, readWritten } from './instrumented-modules.js';
import { coverageModule } from './coverage-rows.js';
import { joinReadings, ownCut } from './readings.js';
import { runCrossings, runModuleIds } from './run-crossings.js';
import { freshCases } from './case-fold.js';
import { caseAttempts } from './case-attempts.js';
import { caseDurations, caseLimits } from './case-durations.js';
import {
  coverageTest,
  noteAnEmptyRecord,
  oneRowPerFile,
  type FinishedFile,
} from './finished-files.js';
import { noteABusyIndex, withIndexLock } from './index-lock.js';
import { removeSeamModules, type SelectionRun } from './selection-run.js';
import { governingPreconditions } from './governing-config.js';
import { markCheckout } from './cache-layers.js';
import { repositoryRoot } from './repository-root.js';
import type { CoverageModule, TestCoverage } from './index.js';
import { prepareRecord } from './replaced-record.js';

/** Where a fold writes, and which of this seam's own files it clears up after. */
export interface FoldDestination {
  /** The snapshot this run layers onto. */
  readonly coverageFile: string;
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
   * The probes were placed by transforms in other processes, so nobody in this
   * one filled {@link SelectionRun.modules}: cut each module the journals name
   * again from the checkout.
   *
   * A journal that names a module the checkout no longer has is a file whose
   * reach is not known, so the file is recorded incomplete and the module left
   * out, as the Jest reporter does. Without `derive` that is a lost identity,
   * and it throws.
   */
  readonly derive?: boolean;
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
  const { coverageFile } = destination;

  const record = async (finished: readonly FinishedFile[]): Promise<void> => {
    // A worker wrote its journal down; a page handed its own to the runner,
    // which carried it here on the file.
    const written = await readWritten(runDirectory);
    const pages = finished.flatMap((file) => (file.journal === undefined ? [] : [file.journal]));
    if (destination.derive === true) {
      for (const [id, module] of await deriveModules(root, runModuleIds(written, pages), mode)) modules.set(id, module);
    }
    // A file the run read twice is one record, and every row is read in it.
    const joined = joinReadings(modules, ownCut(root, mode));
    const crossings = runCrossings(written, pages, root, joined.readings, modules.keys());
    const unplaced = new Set(crossings.journals.filter((journal) => !journal.placed).map((journal) => journal.test));
    if (destination.derive !== true && unplaced.size > 0) {
      const lost = runModuleIds(written, pages).find((id) => !modules.has(id));
      throw new Error(`variance-authority lost the source identity for module ${lost}`);
    }
    // A file the selection ran in part is incomplete too: the cases it skipped
    // keep the reach they had. See `case-cut.ts`.
    // FIXME: so the next selection runs that file whole, and a loop of edits
    // alternates cut and whole runs of it; the record would have to keep the
    // skipped cases' reach for the file to read whole after a cut.
    const files = finished.map((file) =>
      unplaced.has(projectPath(root, file.filepath)) || run.cut.has(file.filepath) ? { ...file, complete: false } : file);
    const numbered = crossings.numbered(joined.modules);

    // One row per path, not per project run of it: two projects that both match
    // a file are two announcements of one test file, and the snapshot is keyed
    // by path.
    const perFile = oneRowPerFile(files, root).map((file) => ({ file, governing: governingPreconditions(run, file.configs) }));
    const texts = runTexts(perFile.map(({ file, governing }) => ({ test: file.filepath, governing })), run.startedAt);
    const tests = perFile.map(({ file, governing }) => coverageTest(
      texts.moved(file.filepath, governing) ? { ...file, complete: false } : file,
      root,
      governing,
      texts.digests,
      crossings,
      numbered,
    ));
    const commit = await commitOf(root);
    const current: TestCoverage = {
      version: 3,
      instrumentation: instrumentationId(mode),
      ...(commit === undefined ? {} : { commit }),
      tests: tests.sort((left, right) => codeUnitOrder(left.file, right.file)),
      modules: [...joined.modules]
        .map(([id, module]): CoverageModule => coverageModule(
          module,
          (block) => crossings.observed(id, block.ordinal),
          (block) => crossings.early(id, block.ordinal),
        ))
        .sort((left, right) => codeUnitOrder(left.file, right.file)),
    };
    // In the record, with the coverage, in one write. `run.cases` is whether
    // the run could record a case: one whose files ran in a page could not.
    // One that could, and recorded no case and finished no file — no worker
    // loaded this seam's modules — has none to lay, and the record's cases
    // stay as they were.
    const cases = run.cases
      ? await freshCases(caseDirectory, root, joined.modules, {
          tests,
          ...(commit === undefined ? {} : { commit }),
          durations: caseDurations(files, root),
          limits: caseLimits(files, root),
          tried: caseAttempts(files, root),
        }, joined.readings)
      : undefined;
    const merged = await withIndexLock(coverageFile, async (lock) => {
      // The repository's snapshot becomes this checkout's before the first run
      // lands on it, so a worktree layers onto months of recording rather than
      // onto nothing. A no-op in the primary checkout and after the first run,
      // and not asked by a shard that is a part of one whole run. A cached record
      // under other probes goes first, whichever run this is.
      await prepareRecord(lock, root, laidProbes(current), { alone: run.alone });
      await landRun(coverageFile, current, root, undefined, cases);
      markCheckout(repositoryRoot(root));
    });
    // A run that placed no module says so once the snapshot saying every file
    // may be skipped is written. A run the lock refused wrote none, and the busy
    // warning is the whole story.
    if (merged.held) noteAnEmptyRecord(files.length, modules.size, destination.unreached);
    else noteABusyIndex(coverageFile);
    await rm(runDirectory, { recursive: true, force: true });
    await rm(caseDirectory, { recursive: true, force: true });
    await rm(run.finishedDirectory, { recursive: true, force: true });
    await rm(run.cutFile, { force: true });
    run.cut.clear();
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
  };
}
