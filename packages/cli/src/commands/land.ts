import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import { OperatorError } from '../exit.js';
import { said } from '../here.js';
import type { LandedJourneys } from './journeys.js';
import { isMissing, messageOf } from './resources.js';
import { landingRecord } from './suite-record.js';

/**
 * N shard snapshots into the one this repository reads, and the reading points
 * at it.
 *
 * The other half of the recipe `mergeReports` completes for reports. A suite
 * too large for one machine records one snapshot per job, and until they are
 * one file nothing here can be asked about the suite: `journeyAgainst` reads a
 * single path and so does everything a runner layers over. The fold itself is
 * `foldTestCoverage`'s and refuses by name, for the same reasons `mergeReports`
 * does; this is the glue that reads the shards, lands the result where the
 * runner would have put it, and says so.
 *
 * Landing is a *layer*, not a replacement, and by the runner's own rule. A
 * snapshot already at the target — the local runs of a laptop, or last week's
 * fold — is what the fold is merged over with `mergeCoverage`, so the result
 * stands at the fold's commit, retires every observation the fold re-recorded
 * whole, and keeps the ones it did not. That is how a fetched baseline lands
 * under local evidence rather than deleting it, and how a full run on the
 * default branch becomes the floor every local run stands on.
 *
 * The case index beside the target is part of the same record: `recordings()`
 * and `recordedExecutionFile` read it as the cases of the snapshot beside it.
 * Each shard's seam left its own beside its snapshot, and those are laid over
 * the target's in the same order; a shard that left none takes the target's
 * index with it, so nobody reads cases the snapshot has replaced. See
 * `landCaseIndexes`.
 *
 * A target that exists and cannot be read is refused rather than replaced. The
 * runner replaces, because it reaches that file from inside a teardown where a
 * refusal is easiest to miss; an operator who typed this command is at the
 * keyboard, and a sentence naming the file is worth more than the evidence a
 * silent overwrite would cost.
 */
export async function landJourneys(
  root: string,
  shards: readonly string[],
  into?: string,
): Promise<LandedJourneys> {
  const selection = await import('@variance-authority/sense/test-selection');
  const at = into ?? (await landingRecord(root));

  const read = await Promise.all(
    shards.map(async (path) => {
      try {
        return { path, coverage: await selection.readTestCoverage(path) };
      } catch (error) {
        throw new OperatorError(
          isMissing(error)
            ? `there is no snapshot at ${said(path)}`
            : `the snapshot at ${said(path)} could not be read: ${messageOf(error)}`,
          { cause: error },
        );
      }
    }),
  );

  let folded;
  try {
    folded = selection.foldTestCoverage(read);
  } catch (error) {
    throw new OperatorError(messageOf(error), { cause: error });
  }

  // A worktree's first landing starts from the primary checkout's record and
  // case index, as its first `yarn test` does; without the copy the fold would
  // land over nothing and stand for the whole suite. A no-op for `--into` and
  // in the primary checkout.
  await selection.seedTestCoverage(at, root);

  // The snapshot is read, merged and written under the lock every runner seam
  // takes on it, and the case index is laid inside that, under its own: the
  // two answer for the same runs, and a run landing between them would leave
  // each one describing a different suite. The snapshot is staged beside the
  // target first, so a write that fails leaves both as they were; then the
  // index lands, so a busy index refuses before the snapshot is replaced; and
  // the staged file is renamed over the target last, which does not fail on a
  // full disk the way a write does.
  const staged = `${at}.${process.pid}-${randomUUID()}.landing`;
  const locked = await selection.withIndexLock(at, async () => {
    let previous;
    try {
      previous = await selection.readTestCoverage(at);
    } catch (error) {
      if (!isMissing(error)) {
        throw new OperatorError(
          `the snapshot already at ${said(at)} could not be read: ${messageOf(error)}. ` +
            'Delete it and land again; a fold written over it would have replaced evidence ' +
            'nobody could see.',
          { cause: error },
        );
      }
    }

    const landed = selection.mergeCoverage(previous, folded);
    try {
      await selection.writeTestCoverage(staged, landed);
      const cases = await selection.landCaseIndexes(at, root, read);
      if ('busy' in cases) throw busy(cases.busy, at);
      await rename(staged, at);
      return { landed, cases };
    } finally {
      await rm(staged, { force: true });
    }
  });
  if (!locked.held) throw busy(at, at);
  const { landed, cases } = locked.value;

  return {
    at,
    shards: read.length,
    ...(landed.commit === undefined ? {} : { commit: landed.commit }),
    observations: landed.tests.length,
    modules: landed.modules.length,
    cases,
  };
}

/**
 * A landing that cannot take a lock is refused whole, and exits non-zero. The
 * lock already waits for the holder, and one held past that is a run still
 * writing, so a retry here would only wait longer for the same answer. Nothing
 * was written, so landing again once that run ends is an ordinary landing.
 */
function busy(file: string, at: string): OperatorError {
  return new OperatorError(
    `nothing landed at ${said(at)}: another process is holding ${said(`${file}.lock`)}. ` +
      'Land again once that run ends.',
  );
}
