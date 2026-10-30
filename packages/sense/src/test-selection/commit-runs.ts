/**
 * The runs recorded at one commit, and the commit the snapshot stood at before
 * the first of them.
 *
 * A snapshot names one commit: the one its latest run was recorded at. So once
 * a run lands, the commit the recording stood at before it is gone, and that is
 * the commit a change has to be read from. A pipeline restores the recording
 * `main` made, runs the suite on a pull request, and then asks what the pull
 * request changed and what the suite did about it; without this file the
 * answer would be measured from the pull request's own head, which is nothing.
 *
 * It is kept per commit, not per run, because one commit is rarely one run. A
 * pipeline runs a suite in several invocations, retries a job, or restores a
 * cache a failed attempt at the same commit already saved. The second run at a
 * commit is laid over the first, and a record of only the last run would name
 * the pull request's head as the base and one invocation's files as the run.
 * So a run at the commit the record already names keeps its base and adds its
 * files, and only a run at another commit starts the record again.
 *
 * `over` answers where the change these runs ran for starts, and that is one
 * commit. Where each test stands is a different question with one answer per
 * test. A partial run at one commit and another at the next leave a test the
 * first ran on the first commit's text, and a test neither ran on the text
 * before both. So the record also carries `standing`: for every test the runs
 * at its commit did not observe, the commit whose text that test last ran on.
 * It is carried forward from the record it replaces, never worked out again,
 * because once a run lands, the snapshot no longer says.
 *
 * Where the record it replaces cannot place a test either, the test is listed
 * at that record's `over` and marked assumed, and the mark travels with it. So
 * the assumption is made once, at the start of the runs that could not say,
 * and a later run's `over` never moves it. A record that places nothing — none
 * beside the snapshot, or one naming another commit — and a test with no place
 * and no start leave `standing` absent rather than guessed, until a run
 * observes every test and there is nothing left to say.
 *
 * Written beside the snapshot, and by every writer of the snapshot rather than
 * by one seam: which runner recorded a run is not a question its reader should
 * have to ask. A landing of shard snapshots is one of those writers. Its fold is
 * one run of the suite at the shards' commit, and the shards name the test files
 * they ran, so it is recorded by the same rules as a run.
 */

// compass: variance-authority.reach

import { readFile } from 'node:fs/promises';
import { followRowsIn } from './case-cuts.js';
import { editsBetween } from './region-edit.js';
import { casesRan, dropsCasesWithoutAny, layCases, textsIn, unansweredOver, type FreshCases, type ModuleTexts } from './case-landing.js';
import { casesRecordedOver, recordOfCases, withCaseSections } from './case-record.js';
import { commitRunsIn, commitRunsText } from './commit-runs-text.js';
import { askCoverageFile } from './coverage-file.js';
import { anotherBuilds, layeredOver, recordBytes } from './format-layer.js';
import { RecordWithoutCoverage } from './format-validation.js';
import { openTestCoverage } from './format-view.js';
import type { TestCoverage } from './index.js';
import { keepRecordedInstall, type KeptInstall } from './kept-install.js';
import { keepRecordedTexts, landedTree, ranOverTexts, type KeptTexts } from './kept-texts.js';
import { landingsAfter, observedBy, whatLanded, type Landing, type RanTests } from './landings.js';
import { ownLayerAfter, readOwnLayer, workingTree, writeOwnLayer } from './own-layer.js';
import { recordBase, takeReadFor } from './record-base.js';
import { standingAfter } from './standing-after.js';
import { writeCoverageBytes } from './record-location.js';

/**
 * One commit's runs, as `coverage.runs.json` holds them: what a review reads to
 * know where a change starts and which test files ran for it.
 */
export interface CommitRuns {
  /** The commit the runs were recorded at. Absent outside a checkout, where every run starts the record again. */
  readonly commit?: string;
  /**
   * Where these runs started: the commit of the snapshot the first of them was
   * laid over, and a review's start. Absent when there was no snapshot, when it
   * named no commit, or when it was recorded by other probes: a run is never
   * laid over that record, it is refused. When a landing renamed its snapshot here
   * and died before its record, the record it left names the commit that
   * landing was laid over, and a run after it carries that commit rather than
   * the one the snapshot stands at.
   *
   * Written without asking git. It is where the change these runs ran for
   * starts only when `commit` descends from it, and a review asks git that
   * where it runs: a landing may be written outside the checkout, or before
   * the other commit was fetched. It says nothing about any one test: that is
   * `standing`.
   */
  readonly over?: string;
  /**
   * When the latest run at `commit` landed, the one that wrote the snapshot,
   * also one that observed no test. A seeded record keeps the base's. When a
   * test file ran is its landing's to say.
   */
  readonly latest: string;
  /**
   * How many runs landed at this commit. 0 in a worktree's record before its
   * first run: the record was seeded beside the primary checkout's snapshot and
   * speaks for the base's runs, not for any of this checkout's; it carries the
   * base's landings as they are, each one run that landed.
   */
  readonly runs: number;
  /**
   * Each run at `commit` while a test file it finished has not been finished
   * again there, earliest first (`landings.ts`): a file's time, install and
   * texts are the one landing's that lists it, and the files the runs at
   * `commit` observed are the ones their landings list (`whatLanded`). A record
   * written before landings were kept reads as one landing of the files, span
   * and install it held (`commitRunsIn`), and the text lists those files beside
   * the landings, for a build that keeps none (`commitRunsText`).
   */
  readonly landings: readonly Landing[];
  /**
   * The commit each other test in the snapshot last ran at, each with its test
   * files in code-unit order. A test a landing lists is not listed. The commits are
   * in the order their runs landed, earliest first, which is oldest first only
   * along one line of history: a run may land at a commit older than the last.
   *
   * An entry is observed, or `assumed`: a record that could not place those
   * tests listed them at its own `over`, and a reader says it read them there
   * on an assumption. Absent when the run that wrote this record could not
   * place a test and had no start to assume: the record it replaced did not
   * speak for the snapshot the run was laid over. A reader that falls back, to
   * `over` or to `commit`, says it did.
   */
  readonly standing?: readonly StandingEntry[];
}

/** Tests that last ran at one commit, or were assumed to have when no record could say. */
export interface StandingEntry {
  readonly commit: string;
  readonly files: readonly string[];
  readonly assumed?: true;
  /**
   * Test files these runs ran only in part, which stand elsewhere: a reader
   * names this stand beside their place until a run finishes them.
   */
  readonly partly?: readonly string[];
  /**
   * The cases these runs laid into the case index of each file in `partly`,
   * by the id the index names them by: those are this stand's, and the file's
   * others are its place's. None when they kept no cases, so every case of the
   * file is its place's and only its rows are both. Absent when the record does
   * not say which, so which are this stand's is not known.
   */
  readonly cases?: Readonly<Record<string, readonly string[]>>;
  /** The install they ran on, as the landing they ran in said it (`kept-install.ts`); absent when not known. */
  readonly installed?: KeptInstall;
  /**
   * The texts they ran over where they differ from `commit`'s: each edited
   * module they instrumented, by the digest of its text (`kept-texts.ts`).
   * Empty when they ran over the commit's own. Absent when that is not known:
   * a record written before texts were named, a run outside a checkout, or a
   * landing of shards that did not all name one set. A module it does not
   * name ran over the commit's text only while the stand says it knows.
   */
  readonly texts?: KeptTexts;
  /**
   * When the runs they last ran in landed, as their landing said it while it
   * was the record's own, and how many there were. Carried from record to record with the tests, never worked out
   * again. Absent when that is not known: an assumed stand, and a record
   * written before stands carried it.
   */
  readonly first?: string;
  readonly latest?: string;
  readonly runs?: number;
}

/** Where the runs recorded into the snapshot at `coverageFile` are listed. */
export function commitRunsFile(coverageFile: string): string {
  const stem = coverageFile.endsWith('.bin') ? coverageFile.slice(0, -'.bin'.length) : coverageFile;
  return `${stem}.runs.json`;
}

/**
 * What the runs record reads of a snapshot, or of a run laid over one: the
 * probes it was recorded under, the commit it names, and its test files. A
 * {@link TestCoverage} is one.
 */
export type RecordedTests = Pick<TestCoverage, 'instrumentation' | 'commit'> & {
  readonly tests: readonly { readonly file: string }[];
};

/**
 * Lay `current` over the snapshot, add it to the runs at its commit, and keep
 * the text of every module it recorded over an edit (`kept-texts.ts`). `cases`,
 * the run's own case index, is written with the coverage in the same write. The
 * caller holds the index lock: the read here and the write after it are one, so
 * two processes finishing together each add their files and their cases.
 */
export async function landRun(
  coverageFile: string,
  current: TestCoverage,
  root: string,
  cacheRoot?: string,
  cases?: FreshCases,
): Promise<void> {
  if (current.modules.length === 0) {
    // A complete row over no module would say its file reaches nothing. An
    // incomplete one says its file must run, which is true without a module:
    // probes fired where nothing could place them. A run with no such file lands
    // its cases alone (`landUncovered`).
    const selecting = current.tests.filter((test) => !test.complete);
    if (selecting.length === 0) return landUncovered(coverageFile, root, cases);
    if (selecting.length < current.tests.length) {
      return landRun(coverageFile, { ...current, tests: selecting }, root, cacheRoot, cases);
    }
  }
  const before = await recordedSnapshot(coverageFile);
  const held = await heldCommitRuns(coverageFile);
  const previous = casesRecordedOver(coverageFile);
  // The run's modules are named with the text each was cut from, so a module
  // re-cut over the text the index already holds lands its cases as its rows do.
  const texts = cases === undefined && previous.index === undefined ? undefined : recordedTexts(coverageFile);
  // The run's cases are laid over the record's (`case-landing.ts`), over no index
  // only once it finished the snapshot's files. A run that kept none leaves the
  // record's, or none once it finished a file.
  const laid = cases === undefined
    ? (dropsCasesWithoutAny(current) ? {} : previous)
    : unansweredOver(previous, before?.tests, cases.run.tests, root).length > 0
      ? previous
      : layCases(previous, cases.fresh, root, { ...cases.run, modules: current.modules }, cases.eyes, texts, before?.commit, undefined, cacheRoot);
  const over = await recordBytes(coverageFile);
  const coverage = await layeredOver(coverageFile, over, current, root, cacheRoot);
  // The rows of a module this run did not record may have been re-cut to the
  // text on disk; the cases held for it are laid onto the same cut (`case-cuts.ts`).
  const followed = laid.index === undefined ? laid : followRowsIn(laid, openTestCoverage(coverage), texts, editsBetween(root, cacheRoot, [before?.commit, current.commit]));
  const bytes = withCaseSections(coverage, { ...followed, base: recordBase(over, current.commit, before?.commit, takeReadFor(coverageFile)) });
  await writeCoverageBytes(coverageFile, bytes);
  // The snapshot's rows are coordinates in the texts on disk now, and the
  // commit it names holds none of the edited ones. Kept after the write, so a
  // text is never kept for a row that did not land.
  // What differs from `HEAD` is asked once, for both.
  const landed = current.commit === undefined ? undefined : await landedTree(root, cacheRoot);
  const kept = await keepRecordedTexts(landed, openTestCoverage(bytes));
  // So is the install it ran on, before the record that names it.
  const installed = await keepRecordedInstall(landed);
  // And the texts it ran over, named whether or not a text could be kept.
  const ranOver = ranOverTexts(landed, current);
  // FIXME: two writes, and nothing makes them one. A failed record write, or a
  // process killed between them, leaves the snapshot at this run's commit
  // beside the record of the one before: the shape `commitRunsAfter` reads as
  // a retried landing, which the next run here repairs and nothing else does.
  // A run whose cases are not in the record laid none.
  const ranCases = cases === undefined || laid.index === undefined ? 'none' : casesRan(laid);
  await writeCommitRuns(commitRunsFile(coverageFile), commitRunsAfter(before, held, { ...current, laid: ranCases }, installed, ranOver));
  // The ledger last: it names this run's tests as this checkout's, and a
  // landing that died before it leaves them read as the milestone's, which a
  // re-run here corrects. A record with no ledger was laid before there was
  // one, and gains none here: its rows are nobody's in particular.
  const layer = await readOwnLayer(coverageFile);
  if (layer !== undefined && current.commit !== undefined) {
    // Only a run that kept an edited text ran over uncommitted edits it
    // recorded, and only then is the working state worth a tree.
    const tree = kept.length > 0 ? workingTree(root) : undefined;
    const state = { commit: current.commit, ...(tree === undefined ? {} : { tree }) };
    await writeOwnLayer(coverageFile, ownLayerAfter(layer, state, current.tests.map((test) => test.file)));
  }
}

/**
 * Land a run that instrumented no module. Its coverage is absent, not empty: a
 * record saying its tests reach nothing would let every later selection skip
 * them. So only the cases move. The record keeps the coverage it held, section
 * for section; a record with none to keep is the cases alone, which a reader
 * answers *unmeasured* for (`RecordWithoutCoverage`); and a run that kept no
 * cases, or ones a record of no index does not take (`unansweredOver`), writes
 * nothing.
 *
 * The runs record and the ledger are left as they were: they say where tests
 * stand, and this run measured nothing for a test to stand on.
 */
async function landUncovered(coverageFile: string, root: string, cases: FreshCases | undefined): Promise<void> {
  if (cases === undefined) return;
  const snapshot = await recordedSnapshot(coverageFile);
  const previous = casesRecordedOver(coverageFile);
  if (unansweredOver(previous, snapshot?.tests, cases.run.tests, root).length > 0) return;
  const stands = snapshot?.commit;
  const over = await recordBytes(coverageFile);
  const laid = layCases(previous, cases.fresh, root, cases.run, cases.eyes, undefined, stands);
  const held = coveredRecord(coverageFile, over);
  const based = { ...laid, base: recordBase(over, cases.run.commit, stands, takeReadFor(coverageFile)) };
  if (held !== undefined) return writeCoverageBytes(coverageFile, withCaseSections(held, based));
  return writeCoverageBytes(coverageFile, recordOfCases(based));
}

/**
 * `bytes`, the record at `coverageFile`, when it holds coverage; `undefined`
 * when it is missing or holds none. One this build cannot open is refused, as a covered
 * run refuses it ({@link anotherBuilds}): writing the cases alone over it would
 * drop its evidence.
 */
function coveredRecord(coverageFile: string, bytes: Buffer | undefined): Buffer | undefined {
  if (bytes === undefined) return undefined;
  try {
    openTestCoverage(bytes);
    return bytes;
  } catch (error) {
    if (error instanceof RecordWithoutCoverage) return undefined;
    throw anotherBuilds(coverageFile, error);
  }
}

/**
 * The runs record once `current` is laid over the snapshot `before`, where
 * `held` is the record beside that snapshot.
 *
 * The test files are `current`'s own, as its runner recorded them. Nothing here
 * works them out again. A snapshot under other probes is no base, so the record
 * then names none; a run refuses to lay over one ({@link landRun}), and only a
 * caller that passes it reaches here with it.
 *
 * {@link landRun} reads both inputs off the disk. A landing of shard snapshots
 * has already read the snapshot to merge over it, and passes that.
 *
 * `installed` is the install `current` ran on, which {@link landRun} keeps,
 * and `texts` the texts it ran over (`ranOverTexts`); a landing of shards
 * passes the ones their own landings named, when they agree (`shardsInstall`,
 * `shardsTexts`).
 */
export function commitRunsAfter(
  before: RecordedTests | undefined,
  held: CommitRuns | undefined,
  current: RanTests,
  installed?: KeptInstall,
  texts?: KeptTexts,
): CommitRuns {
  const prior = before?.instrumentation === current.instrumentation ? before : undefined;
  const stood = prior?.commit;
  const at = new Date().toISOString();
  // The snapshot already stands at this commit and the record says what it
  // stood at before: this run is one more at the commit, not a new change.
  // Runs outside a checkout name no commit, so they all stand at one place. A
  // record of no runs was seeded from the base, and the first run over it
  // starts this checkout's change.
  const again =
    prior !== undefined && held !== undefined && stood === current.commit && held.commit === current.commit && held.runs > 0;
  // The snapshot stands at this commit and the record at another: a landing
  // renamed its snapshot and died before its record. The record still names
  // the commit that landing was laid over, and it is this run's start too, and
  // it still says where each test stood over that commit.
  const retried =
    current.commit !== undefined && stood === current.commit && held?.commit !== undefined && held.commit !== current.commit;
  const over = again ? held.over : retried ? held.commit : stood;
  const landings = landingsAfter(again ? held.landings : [], observedBy(prior, current), at, installed, texts);
  const ran = whatLanded(landings).files;
  const standing = current.commit === undefined ? undefined : standingAfter(prior, held, retried ? held.commit : stood, ran);
  return {
    ...(current.commit === undefined ? {} : { commit: current.commit }),
    ...(over === undefined ? {} : { over }),
    latest: at,
    runs: again ? held.runs + 1 : 1,
    ...(standing === undefined ? {} : { standing }),
    landings,
  };
}

/**
 * Write `record` to `to`, whole or not at all: to {@link commitRunsFile} of the
 * snapshot, or to a file staged beside it that the caller renames over it.
 */
export async function writeCommitRuns(to: string, record: CommitRuns): Promise<void> {
  await writeCoverageBytes(to, Buffer.from(commitRunsText(record)));
}

/**
 * The runs recorded into the snapshot at `coverageFile`, or `undefined` when no
 * run has listed itself: when there is no file at all.
 *
 * A record that is there and cannot be read throws, naming the file, and so
 * does one {@link commitRunsIn} refuses: it says where each test last ran, and a
 * reader that took it for *no record* would place every test at the journal's
 * commit, which can skip a test that should run. Each caller says what the
 * record was for and what to do. A writer need not refuse: {@link heldCommitRuns}
 * lets it write a record that says less, and says so.
 */
export async function readCommitRuns(coverageFile: string): Promise<CommitRuns | undefined> {
  const file = commitRunsFile(coverageFile);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`the runs record at ${file} could not be read: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  return commitRunsIn(text, `the runs record at ${file}`);
}

/**
 * The record a writer lays its run over: {@link readCommitRuns}, except that a
 * record this cannot read is no record to carry forward. The writer then
 * writes a fresh one, which places no test it did not run, and `warn` is told
 * so, naming the file. Refusing would leave the same fresh record to be
 * written by hand, after deleting this one, and would fail every run until then.
 */
export async function heldCommitRuns(
  coverageFile: string,
  warn: (line: string) => void = (line) => console.warn(`variance-authority: ${line}`),
): Promise<CommitRuns | undefined> {
  try {
    return await readCommitRuns(coverageFile);
  } catch (error) {
    warn(
      `${error instanceof Error ? error.message : String(error)}; this run writes it afresh, so it says ` +
        'where each test last ran only as an assumption until the runs at one commit together observe every test.',
    );
    return undefined;
  }
}

/** The text each module of the snapshot at `coverageFile` was cut from; `undefined` when it holds none this build reads. */
function recordedTexts(coverageFile: string): ModuleTexts | undefined {
  try {
    return askCoverageFile(coverageFile, textsIn);
  } catch {
    return undefined;
  }
}

/** The snapshot at `coverageFile` as the runs record reads it, or `undefined` when there is none to read. */
async function recordedSnapshot(coverageFile: string): Promise<RecordedTests | undefined> {
  try {
    return await askCoverageFile(coverageFile, (coverage) => ({
      instrumentation: coverage.instrumentation,
      ...(coverage.commit === undefined ? {} : { commit: coverage.commit }),
      tests: Array.from(coverage.testPath.all(), (path) => ({ file: coverage.string(path) })),
    }));
  } catch {
    return undefined;
  }
}
