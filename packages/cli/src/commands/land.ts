import { randomUUID } from 'node:crypto';
import { readFile, rename, rm } from 'node:fs/promises';
import type { CommitRuns, TestCoverageView } from '@variance-authority/sense/test-selection';
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
 * `combineRecords`'s, in the native addon, and refuses by name, for the same
 * reasons `mergeReports` does: it writes the one record an unsharded run would
 * have written, beside the target. This lands that record where the runner
 * would have put it, as the one run it is, and says so.
 *
 * Landing is a *layer*, not a replacement, and by the runner's own rule: a
 * snapshot already at the target — the local runs of a laptop over the record
 * the build cached — is what the fold is laid over, through the lay a runner's
 * teardown goes through (`landedCoverage`), so the result stands at the fold's
 * commit, retires every observation the fold re-recorded whole, and keeps the
 * ones it did not. The runs record beside it names the local snapshot's commit
 * as the one the fold was laid over, whatever the history between the two:
 * whether that commit is where a change starts is asked of git by the review
 * that reads it, not here, where the landing may run outside the checkout or
 * before the other commit was fetched.
 *
 * The cases travel in the record (spec 0094): each shard's seam kept its own in
 * the shard's record, the combine folds them into one index, and that is laid
 * over the target's and written into the record the landing writes; shards that
 * kept none take the target's with them, so nobody reads cases the snapshot has
 * replaced. See `landCases`. A module whose rows the landing re-cut to another text has its
 * held cases laid onto the same cut (`followRows`).
 *
 * A shard whose run instrumented nothing holds its cases and no coverage. It is
 * unmeasured, so it folds no coverage and names no install, and its cases are
 * laid with the others', its files finished as its last run ran them. Landed alone where no coverage stands, it writes a
 * record of cases and no coverage, which narrows no later selection.
 *
 * A target that exists and cannot be read, or one under other probes, is
 * refused rather than replaced, as the runner refuses it: one build reads what
 * it wrote under one set of probes, so either is another build's, and a
 * sentence naming the file is worth more than the evidence a silent overwrite
 * would cost.
 */
export async function landJourneys(
  root: string,
  shards: readonly string[],
  into?: string,
): Promise<LandedJourneys> {
  const selection = await import('@variance-authority/sense/test-selection');
  const at = into ?? (await landingRecord(root));
  if (into !== undefined && selection.writesBase(selection.repositoryLayers(root), into)) {
    throw new OperatorError(
      `${into} is the record the primary checkout's runs write, which this worktree's runs are laid over and never write. ` +
        'Land without `--into`, and the landing is laid over it in this worktree\'s own layer.',
    );
  }

  // The combine is staged beside the target, so the rename below never crosses
  // a file system, and the staged name ends in `.tmp` for prune to find.
  const combinedAt = `${at}.${process.pid}-${randomUUID()}-combined.tmp`;
  try {
    return await landCombined(selection, root, shards, at, combinedAt);
  } finally {
    await rm(combinedAt, { force: true });
  }
}

type Selection = typeof import('@variance-authority/sense/test-selection');

async function landCombined(
  selection: Selection,
  root: string,
  shards: readonly string[],
  at: string,
  combinedAt: string,
): Promise<LandedJourneys> {
  let combined;
  try {
    combined = selection.combineRecords(shards, combinedAt, root);
  } catch (error) {
    throw new OperatorError(messageOf(error), { cause: error });
  }
  // The record is read off its columns, never decoded: over nothing it is the
  // coverage the landing writes, and what else is asked of it is a few columns.
  const fold = opened(selection, combinedAt, await readFile(combinedAt));
  const measured = combined.shards.filter((shard) => shard.measured);
  const unmeasured = combined.shards.flatMap((shard) => (shard.measured ? [] : shard.files));

  // Each shard's own landing kept the install it ran on in the runs record
  // beside its snapshot, where that shard ran, and named the texts it ran over;
  // the fold ran on them only when every shard names the same ones. A record
  // that cannot be read names none. A shard that recorded no test file ran no
  // test they could speak for, so it names nothing either way and is left out.
  // FIXME: the texts a shard's install names are kept in the cache of the
  // machine it ran on, and nothing carries them here, so a shard that ran over
  // an uncommitted install elsewhere is compared from its commit after all.
  const ran = fold === undefined
    ? undefined
    : await Promise.all(
        measured.filter((shard) => shard.files.length > 0).map(async (shard) => ({
          tests: { ...(shard.commit == null ? {} : { commit: shard.commit }), tests: shard.files.map((file) => ({ file })) },
          runs: await shardRuns(shard.path),
        })),
      );
  const installed = ran === undefined ? undefined : selection.shardsInstall(ran);
  const ranOver = ran === undefined ? undefined : selection.shardsTexts(ran);

  // A checkout's first landing starts from the base its first `yarn test`
  // would: the mainline's record as last fetched here, else the primary
  // checkout's. Without the copy the fold would land over nothing and stand for
  // the whole suite. A no-op for `--into` and after the first landing.
  selection.noteSeeded(await selection.seedTestCoverage(at, root, fold?.coverage.instrumentation));

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
    let [previous, over]: [Opened | undefined, Buffer | undefined] = [undefined, undefined];
    try {
      over = await readFile(at);
      previous = opened(selection, at, over);
    } catch (error) {
      // A record whose run instrumented nothing has no coverage to fold over,
      // and its cases are laid under the shards' below.
      if (!isMissing(error) && !(error instanceof selection.RecordWithoutCoverage)) {
        throw unreadable(at, error);
      }
    }

    // The coverage is laid first, while nothing else the landing reads is held.
    let bytes: Uint8Array | undefined;
    try {
      bytes = fold === undefined ? previous?.bytes : selection.landedCoverage(previous?.bytes, fold.bytes);
    } catch (error) {
      throw unlaid(at, error);
    }
    const landed = bytes === undefined ? undefined : selection.openTestCoverage(bytes);
    const folded = fold === undefined ? undefined : selection.recordedRun(fold.coverage);
    // The one run the shards were: what the coverage recorded, and every file a
    // shard that measured nothing ran, finished, so its cases retire the target's.
    const run = folded === undefined && unmeasured.length === 0
      ? undefined
      : {
          tests: [...(folded?.tests ?? []), ...unmeasured.map((file) => ({ file, complete: true }))],
          ...(combined.commit == null ? {} : { commit: combined.commit }),
          ...(folded === undefined ? {} : { modules: folded.modules }),
        };
    // A runs record that cannot be read is written afresh, and said so, as a
    // runner's `landRun` does: refusing would leave the operator to delete it
    // and land again, which writes the same record.
    const held = await selection.heldCommitRuns(at, (line) => process.stderr.write(`variance: ${line}\n`));
    const before = previous === undefined ? undefined : selection.recordedRun(previous.coverage);
    // The index beside the snapshot was cut from the texts the snapshot names,
    // and a module no shard recorded is laid onto the cut its rows landed at.
    const texts = selection.textsOf(before);
    const { landing, sections: laid } = selection.landCases(
      at,
      selection.caseSectionsAt(at),
      root,
      [{ path: combinedAt, ...(run === undefined ? {} : { coverage: run }) }],
      texts,
      before?.commit,
    );
    // The landing laid at most one record, the combine's, and that record's
    // cases are those of every shard the combine folded a case index from.
    // Where it kept none, every shard it folded kept none: the combine
    // refuses shards of which only some kept cases.
    const cased = combined.shards.filter((shard) => shard.cased).length;
    // Shards that kept their cases name the ones they executed of a file they ran in part.
    const executed = 'laid' in landing && landing.shards > 0 ? selection.casesRan(laid) : undefined;
    const runs = folded === undefined
      ? undefined
      : selection.commitRunsAfter(before, held, { ...folded, ...(executed === undefined ? {} : { executed }) }, installed, ranOver);
    const cases = 'laid' in landing
      ? { ...landing, shards: landing.shards === 0 ? 0 : cased }
      : { ...landing, shards: [...shards] };
    const sections = landed === undefined
      ? laid
      : selection.followRowsIn(laid, landed, texts, selection.editsBetween(root, undefined, [before?.commit, landed.commit]));
    // Shards that measured nothing and kept no case this build reads, over no
    // coverage, leave nothing to write: the target stays as it was.
    const kept = bytes !== undefined || Object.values(sections).some((part) => part !== undefined);
    // The record names the one every shard read, and the one the landing was
    // laid over, as a run's does.
    const based = { ...sections, base: selection.recordBase(over, combined.commit ?? undefined, before?.commit, combined.read ?? undefined) };
    try {
      if (bytes !== undefined) await selection.writeCoverageBytes(staged, selection.withCaseSections(bytes, based));
      else if (kept) await selection.writeCoverageBytes(staged, selection.recordOfCases(based));
      if (runs !== undefined) await selection.writeCommitRuns(stagedRuns, runs);
      if (kept) await rename(staged, at);
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
      if (runs !== undefined) await rename(stagedRuns, runsAt);
      return {
        landed: landed === undefined
          ? undefined
          : { commit: landed.commit, tests: landed.testPath.length, modules: landed.modulePath.length },
        cases,
      };
    } finally {
      await rm(staged, { force: true });
      await rm(stagedRuns, { force: true });
    }
  });
  if (!locked.held) throw busy(at, at);
  const { landed, cases } = locked.value;

  return {
    at,
    shards: shards.length,
    ...(landed?.commit === undefined ? {} : { commit: landed.commit }),
    observations: landed?.tests ?? 0,
    modules: landed?.modules ?? 0,
    cases,
    ...(combined.unchecked.length === 0 ? {} : { unchecked: combined.unchecked }),
  };
}

/** A record and its coverage, opened where it lies. */
interface Opened {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly coverage: TestCoverageView;
}

/** The snapshot at `at` cannot be read, and is left for the operator to delete. */
function unreadable(at: string, error: unknown): OperatorError {
  return new OperatorError(
    `the snapshot already at ${said(at)} could not be read: ${messageOf(error)}. ` +
      'Delete it and land again; a fold written over it would have replaced evidence ' +
      'nobody could see.',
    { cause: error },
  );
}

/**
 * The snapshot at `at` is another build's — one this build cannot lay over, or
 * one under other probes — and is left for the operator to delete.
 */
function unlaid(at: string, error: unknown): OperatorError {
  return new OperatorError(
    `the shards cannot be laid over the snapshot already at ${said(at)}: ${messageOf(error)}. ` +
      'It was written by another build; delete it and land again.',
    { cause: error },
  );
}

/**
 * `bytes` opened, or `undefined` when the record holds cases and no coverage.
 * A record this build cannot read throws, here and not at the first column a
 * later step reads.
 */
function opened(selection: Selection, path: string, bytes: Uint8Array): Opened | undefined {
  try {
    const coverage = selection.openTestCoverage(bytes);
    void coverage.instrumentation;
    return { path, bytes, coverage };
  } catch (error) {
    if (error instanceof selection.RecordWithoutCoverage) return undefined;
    throw error;
  }
}

/**
 * The runs record beside the shard at `path`, or `undefined` when it has none
 * or none this can read, which is said on stderr: the landing then keeps no
 * install, and a later selection compares from the commit.
 */
async function shardRuns(path: string): Promise<CommitRuns | undefined> {
  const selection = await import('@variance-authority/sense/test-selection');
  try {
    return await selection.readCommitRuns(path);
  } catch (error) {
    process.stderr.write(`variance: ${messageOf(error)}; the landing keeps no install the shards ran on.\n`);
    return undefined;
  }
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
