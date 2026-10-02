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
 * default branch becomes the floor every local run stands on. The runs record
 * beside it names the local snapshot's commit as the one the fold was laid
 * over, whatever the history between the two: a fetched baseline is usually
 * older than the local runs, and whether that commit is where a change starts
 * is asked of git by the review that reads it, not here, where the landing may
 * run outside the checkout or before the other commit was fetched.
 *
 * The cases travel in the record (spec 0094): each shard's seam kept its own in
 * the shard's record, and those are laid over the target's in the same order
 * and written into the record the landing writes; a shard that kept none takes
 * the target's with it, so nobody reads cases the snapshot has replaced. See
 * `landCases`.
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

  // A checkout's first landing starts from the base its first `yarn test`
  // would: the mainline's record as last fetched here, else the primary
  // checkout's. Without the copy the fold would land over nothing and stand for
  // the whole suite. A no-op for `--into` and after the first landing.
  selection.noteSeeded(await selection.seedTestCoverage(at, root));

  // The snapshot is read, merged and written, its cases laid into it, under
  // the lock every runner seam takes on it. The runs record beside the snapshot
  // answers for the same runs, and is written by `commitRunsAfter`, the rules every
  // runner's `landRun` writes it by: the fold is one run at the shards' commit,
  // and its test files are the ones the shards recorded. The snapshot and the
  // record are staged beside their targets first, so a write that fails leaves
  // everything as it was; then the index lands, so a busy index refuses before
  // the snapshot is replaced; and the staged files are renamed over their
  // targets last, which does not fail on a full disk the way a write does. They
  // are staged beside the targets because a rename to another file system
  // fails. The staged names end in the pid and `.tmp`, so beside the default
  // target prune removes them if this process dies before the `finally` does.
  //
  // FIXME: prune reads only `test-selection/<key>`, its `suites/<suite>` and `.work/<key>`, so beside an `--into` target elsewhere a crash leaves these files and the `<staged>.<pid>-<uuid>.tmp` `writeCoverageBytes` writes each through.
  // A fix that removes them needs a floor like prune's `RUN_FLOOR_MS`, since a pid from another host, pid namespace or skewed file-system clock reads as dead,
  // and must report a removal it could not make without failing a landing that already landed.
  //
  const runsAt = selection.commitRunsFile(at);
  const stage = `${process.pid}-${randomUUID()}.tmp`;
  const staged = `${at}.${stage}`;
  const stagedRuns = `${runsAt}.${stage}`;
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

    // A runs record that cannot be read is written afresh, and said so, as a
    // runner's `landRun` does: refusing would leave the operator to delete it
    // and land again, which writes the same record.
    const held = await selection.heldCommitRuns(at, (line) => process.stderr.write(`variance: ${line}\n`));
    const landed = selection.mergeCoverage(previous, folded);
    const runs = selection.commitRunsAfter(previous, held, folded);
    const { landing: cases, sections } = selection.landCases(at, previous === undefined ? {} : selection.caseSectionsAt(at), root, read);
    try {
      await selection.writeTestCoverage(staged, landed, sections);
      await selection.writeCommitRuns(stagedRuns, runs);
      await rename(staged, at);
      // FIXME: the snapshot and the runs record are two files, and nothing
      // renames them together. A crash between these two renames, or this
      // rename throwing, leaves the record as it was before the landing. The
      // snapshot goes first because the other order is worse: at the same
      // commit, a record renamed ahead of its snapshot says the shards ran on
      // rows the snapshot does not hold yet. Landing again repairs the record:
      // `commitRunsAfter` takes a snapshot ahead of its record for this, and
      // carries the start and `standing` from the record the landing was laid
      // over. What it cannot carry is a test only the interrupted landing ran:
      // when the retry lands other shards, that test is listed where it stood
      // before, an older commit than the one it last ran at, so `test:since`
      // reads more of the change for it rather than less.
      await rename(stagedRuns, runsAt);
      return { landed, cases };
    } finally {
      await rm(staged, { force: true });
      await rm(stagedRuns, { force: true });
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
