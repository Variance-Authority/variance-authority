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
import { landedTree } from './kept-texts.js';
import { laidProbes, landRun } from './commit-runs.js';
import { projectPath, readWritten } from './instrumented-modules.js';
import { crossedModules } from './coverage-rows.js';
import type { RunCoverage } from './format.js';
import { joinReadings, ownCut } from './readings.js';
import { runCrossings, runModuleIds } from './run-crossings.js';
import { foldCases, freshCases } from './case-fold.js';
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
    // What git says of the working tree is the slowest answer the write needs,
    // and nothing the fold does changes it: ask before the fold, not after.
    const landing = landedTree(root);
    landing.catch(() => {});
    const written = await readWritten(runDirectory);
    // The run's scratch is four unrelated trees, and each one's removal waits on
    // nothing but its last reader: the journals and the finished files are in
    // memory by now, and the case fold reads its own tree. So they go under the
    // fold rather than after it, and the fold resolves once they are gone.
    const cleared: Array<Promise<void>> = [
      rm(runDirectory, { recursive: true, force: true }),
      rm(run.finishedDirectory, { recursive: true, force: true }),
      rm(run.cutFile, { force: true }),
    ];
    const pages = finished.flatMap((file) => (file.journal === undefined ? [] : [file.journal]));
    if (destination.derive === true) {
      for (const [id, module] of await deriveModules(root, runModuleIds(written, pages), mode)) modules.set(id, module);
    }
    // A file the run read twice is one record, and every row is read in it.
    const joined = joinReadings(modules, ownCut(root, mode, modules));
    // The case fold runs off this thread while the run's own work goes on:
    // started here, it is folded by the time the record wants its bytes.
    // `run.cases` is whether the run could record a case: one whose files ran
    // in a page could not.
    const folding = run.cases
      ? foldCases(caseDirectory, root, joined.modules, {
          durations: caseDurations(finished, root),
          limits: caseLimits(finished, root),
          tried: caseAttempts(finished, root),
          readings: joined.readings,
        })
      : undefined;
    // A refusal below lands before the fold is awaited, and the fold's own
    // failure is read where it is.
    folding?.catch(() => {});
    const removeCases = () => rm(caseDirectory, { recursive: true, force: true });
    cleared.push(folding === undefined ? removeCases() : folding.then(removeCases, removeCases));
    // A refusal below lands before the removals are awaited; theirs are read where they are.
    const clearing = Promise.all(cleared);
    clearing.catch(() => {});
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
    const current: RunCoverage = {
      version: 3,
      instrumentation: instrumentationId(mode),
      ...(commit === undefined ? {} : { commit }),
      tests: tests.sort((left, right) => codeUnitOrder(left.file, right.file)),
      ...crossedModules(joined.modules, crossings),
    };
    // In the record, with the coverage, in one write. A run that could record
    // a case, and recorded none and finished no file — no worker loaded this
    // seam's modules — has none to lay, and the record's cases stay as they
    // were.
    const cases = folding && await freshCases(folding, { tests, ...(commit === undefined ? {} : { commit }) });
    const merged = await withIndexLock(coverageFile, async (lock) => {
      // The repository's snapshot becomes this checkout's before the first run
      // lands on it, so a worktree layers onto months of recording rather than
      // onto nothing. A no-op in the primary checkout and after the first run,
      // and not asked by a shard that is a part of one whole run. A cached record
      // under other probes goes first, whichever run this is.
      await prepareRecord(lock, root, laidProbes(current), { alone: run.alone });
      await landRun(coverageFile, current, root, undefined, cases, undefined, landing);
      markCheckout(repositoryRoot(root));
    });
    // A run that placed no module says so once the snapshot saying every file
    // may be skipped is written. A run the lock refused wrote none, and the busy
    // warning is the whole story.
    if (merged.held) noteAnEmptyRecord(files.length, modules.size, destination.unreached);
    else noteABusyIndex(coverageFile);
    await clearing;
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
