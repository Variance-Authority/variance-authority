import { OperatorError } from '../exit.js';
import type { LandedJourneys } from './journeys.js';
import { isMissing, messageOf } from './resources.js';

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
  const at = into ?? selection.testCoverageFile(root);

  const read = await Promise.all(
    shards.map(async (path) => {
      try {
        return { path, coverage: await selection.readTestCoverage(path) };
      } catch (error) {
        throw new OperatorError(
          isMissing(error)
            ? `there is no snapshot at ${path}`
            : `the snapshot at ${path} could not be read: ${messageOf(error)}`,
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

  let previous;
  try {
    previous = await selection.readTestCoverage(at);
  } catch (error) {
    if (!isMissing(error)) {
      throw new OperatorError(
        `the snapshot already at ${at} could not be read: ${messageOf(error)}. ` +
          'Delete it and land again; a fold written over it would have replaced evidence ' +
          'nobody could see.',
        { cause: error },
      );
    }
  }

  const landed = selection.mergeCoverage(previous, folded);
  await selection.writeTestCoverage(at, landed);

  return {
    at,
    shards: read.length,
    ...(landed.commit === undefined ? {} : { commit: landed.commit }),
    observations: landed.tests.length,
    modules: landed.modules.length,
  };
}
