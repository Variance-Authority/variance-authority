import type { CommitRuns } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { said } from '../here.js';
import type { LandedJourneys } from './journeys.js';
import { isMissing, messageOf } from './resources.js';
import { landingRecord } from './suite-record.js';
import { stagedLanding } from './staged-landing.js';

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
 * `landCases`. A module whose rows the landing re-cut to another text has its
 * held cases laid onto the same cut (`followRows`).
 *
 * A shard whose run instrumented nothing holds its cases and no coverage. It is
 * unmeasured, so it folds nothing and moves no runs record, and its cases are
 * laid with the others'. Landed alone where no coverage stands, it writes a
 * record of cases and no coverage, which narrows no later selection.
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
        if (error instanceof selection.RecordWithoutCoverage) return { path };
        throw new OperatorError(
          isMissing(error)
            ? `there is no snapshot at ${said(path)}`
            : `the snapshot at ${said(path)} could not be read: ${messageOf(error)}`,
          { cause: error },
        );
      }
    }),
  );

  const measured = read.flatMap(({ path, coverage }) => (coverage === undefined ? [] : [{ path, coverage }]));
  let folded;
  try {
    folded = measured.length === 0 ? undefined : selection.foldTestCoverage(measured);
  } catch (error) {
    throw new OperatorError(messageOf(error), { cause: error });
  }
  // A shard that measured nothing names its commit in the run that laid its
  // cases, and is held to the fold's rule: one run, one commit. One that names
  // none, as a record that crossed a checkout does, disagrees with nobody.
  const named = read.flatMap(({ path, coverage }) => {
    const commit = coverage?.commit ?? selection.lastCaseRunOf(selection.caseSectionsAt(path))?.commit;
    return commit === undefined ? [] : [{ path, commit }];
  });
  const other = named.find((shard) => shard.commit !== named[0]!.commit);
  if (other !== undefined) {
    throw new OperatorError(
      `${named[0]!.path} and ${other.path} disagree about the commit (\`${named[0]!.commit}\` against ` +
        `\`${other.commit}\`), so they are not shards of one run and cannot be folded into one.`,
    );
  }

  // Each shard's own landing kept the install it ran on in the runs record
  // beside its snapshot, where that shard ran, and the fold ran on it only when
  // every shard names the same one. A record that cannot be read names none.
  // FIXME: the texts a shard's install names are kept in the cache of the
  // machine it ran on, and nothing carries them here, so a shard that ran over
  // an uncommitted install elsewhere is compared from its commit after all.
  const installed = folded === undefined
    ? undefined
    : selection.shardsInstall(
        await Promise.all(
          measured.map(async ({ path, coverage }) => ({ tests: coverage, runs: await shardRuns(path) })),
        ),
      );

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
  const { landed, cases } = await stagedLanding(at, async (staged, stagedRuns) => {
    let previous;
    try {
      previous = await selection.readTestCoverage(at);
    } catch (error) {
      // A record whose run instrumented nothing has no coverage to fold over,
      // and its cases are laid under the shards' below.
      if (!isMissing(error) && !(error instanceof selection.RecordWithoutCoverage)) {
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
    const landed = folded === undefined ? previous : selection.mergeCoverage(previous, folded);
    const runs = folded === undefined ? undefined : selection.commitRunsAfter(previous, held, folded, installed);
    // The index beside the snapshot was cut from the texts the snapshot names,
    // and a module no shard recorded is laid onto the cut its rows landed at.
    const texts = selection.textsOf(previous);
    const { landing: cases, sections: laid } = selection.landCases(
      at,
      selection.caseSectionsAt(at),
      root,
      read,
      texts,
      previous?.commit,
    );
    const sections = selection.followRows(laid, landed, texts, selection.editsBetween(root, undefined, [previous?.commit, landed?.commit]));
    // Shards that measured nothing and kept no case this build reads, over no
    // coverage, leave nothing to write: the target stays as it was.
    const kept = landed !== undefined || Object.values(sections).some((part) => part !== undefined);
    if (landed !== undefined) await selection.writeTestCoverage(staged, landed, sections);
    else if (kept) await selection.writeCoverageBytes(staged, selection.recordOfCases(sections));
    if (runs !== undefined) await selection.writeCommitRuns(stagedRuns, runs);
    return { kept, runs: runs !== undefined, value: { landed, cases } };
  });

  return {
    at,
    shards: read.length,
    ...(landed?.commit === undefined ? {} : { commit: landed.commit }),
    observations: landed?.tests.length ?? 0,
    modules: landed?.modules.length ?? 0,
    cases,
  };
}

/**
 * The runs record beside the shard at `path`, or `undefined` when it has none
 * or none this can read, which is said on stderr: the landing then keeps no
 * install, and a later selection compares from the commit.
 */
export async function shardRuns(path: string): Promise<CommitRuns | undefined> {
  const selection = await import('@variance-authority/sense/test-selection');
  try {
    return await selection.readCommitRuns(path);
  } catch (error) {
    process.stderr.write(`variance: ${messageOf(error)}; the landing keeps no install the shards ran on.\n`);
    return undefined;
  }
}

