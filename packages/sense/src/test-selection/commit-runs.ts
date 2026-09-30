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

import { readFile } from 'node:fs/promises';
import { askCoverageFile } from './coverage-file.js';
import { layeredCoverage } from './format-layer.js';
import { codeUnitOrder } from './instrumented-modules.js';
import type { TestCoverage } from './index.js';
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
   * named no commit, or when it was recorded by other probes and so was
   * replaced rather than laid over. When a landing renamed its snapshot here
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
  /** When the first and the latest of the runs landed. */
  readonly first: string;
  readonly latest: string;
  /**
   * How many runs landed at this commit. 0 in a worktree's record before its
   * first run: the record was seeded beside the primary checkout's snapshot and
   * speaks for the base's runs, not for any of this checkout's.
   */
  readonly runs: number;
  /** Every test file the runs observed, in code-unit order. */
  readonly files: readonly string[];
  /**
   * The commit each other test in the snapshot last ran at, each with its test
   * files in code-unit order. A test in `files` is not listed. The commits are
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
  readonly standing?: readonly Stand[];
}

/** Tests that last ran at one commit, or were assumed to have when no record could say. */
export interface Stand {
  readonly commit: string;
  readonly files: readonly string[];
  readonly assumed?: true;
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
 * Lay `current` over the snapshot, and add it to the runs at its commit.
 *
 * The caller holds the index lock: the base read here, the write after it and
 * the record of both are one read-modify-write, so two processes finishing
 * together each add their files.
 */
export async function landRun(coverageFile: string, current: TestCoverage, root: string): Promise<void> {
  const before = await recordedSnapshot(coverageFile);
  const held = await readCommitRuns(coverageFile);
  await writeCoverageBytes(coverageFile, await layeredCoverage(coverageFile, current, root));
  // FIXME: two writes, and nothing makes them one. A failed record write, or a
  // process killed between them, leaves the snapshot at this run's commit
  // beside the record of the one before: the shape `commitRunsAfter` reads as
  // a retried landing, which the next run here repairs and nothing else does.
  await writeCommitRuns(commitRunsFile(coverageFile), commitRunsAfter(before, held, current));
}

/**
 * The runs record once `current` is laid over the snapshot `before`, where
 * `held` is the record beside that snapshot.
 *
 * The test files are `current`'s own, as its runner recorded them. Nothing here
 * works them out again. A snapshot under other probes is replaced rather than
 * laid over, so it is no base: the record then names none.
 *
 * {@link landRun} reads both inputs off the disk. A landing of shard snapshots
 * has already read the snapshot to merge over it, and passes that.
 */
export function commitRunsAfter(
  before: RecordedTests | undefined,
  held: CommitRuns | undefined,
  current: RecordedTests,
): CommitRuns {
  const prior = before?.instrumentation === current.instrumentation ? before : undefined;
  const stood = prior?.commit;
  const at = new Date().toISOString();
  const files = current.tests.map((test) => test.file);
  // The snapshot already stands at this commit and the record says what it
  // stood at before: this run is one more at the commit, not a new change. A
  // record of no runs was seeded from the base, and the first run over it
  // starts this checkout's change.
  const again =
    current.commit !== undefined && stood === current.commit && held?.commit === current.commit && held.runs > 0;
  // The snapshot stands at this commit and the record at another: a landing
  // renamed its snapshot and died before its record. The record still names
  // the commit that landing was laid over, and it is this run's start too, and
  // it still says where each test stood over that commit.
  const retried =
    current.commit !== undefined && stood === current.commit && held?.commit !== undefined && held.commit !== current.commit;
  const over = again ? held.over : retried ? held.commit : stood;
  const ran = again ? [...new Set([...held.files, ...files])].sort(codeUnitOrder) : files;
  const standing = current.commit === undefined ? undefined : standingAfter(prior, held, retried ? held.commit : stood, ran);
  return {
    ...(current.commit === undefined ? {} : { commit: current.commit }),
    ...(over === undefined ? {} : { over }),
    first: again ? held.first : at,
    latest: at,
    runs: again ? held.runs + 1 : 1,
    files: ran,
    ...(standing === undefined ? {} : { standing }),
  };
}

/**
 * Write `record` to `to`, whole or not at all: to {@link commitRunsFile} of the
 * snapshot, or to a file staged beside it that the caller renames over it.
 */
export async function writeCommitRuns(to: string, record: CommitRuns): Promise<void> {
  await writeCoverageBytes(to, Buffer.from(`${JSON.stringify(record, null, 2)}\n`));
}

/**
 * Where each test the snapshot held before this run last ran, leaving out the
 * tests `ran` observed, or `undefined` when that is not known.
 *
 * `base` is the commit this run was laid over: the snapshot's own, or on a
 * retried landing the one its record still names. Only the record `held`
 * knows, and only when it names `base`: a test in its `files` stood there, and
 * a test its `standing` lists stood where it says. A test it cannot place is
 * listed at its `over`, marked assumed, which is where `test:since` read it
 * from while that record was the latest; carried, the assumption stays there
 * when a later run moves `over`. No record, a record of another commit, and a
 * test with no place and no `over` are not known, and a guess written here
 * would be read back as a fact at every run after this one. So the answer is
 * absent until a run observes every test the snapshot held, which needs no
 * record at all.
 *
 * A test is listed at the commit this run is at when it last ran there and
 * this run did not observe it, as a run landed at an older commit leaves it: a
 * test the record does not list is one nobody knows about.
 *
 * A worktree's first run is laid over a copy of the primary checkout's
 * snapshot, and the record beside it was seeded with that copy: the base's own
 * record, with no run of this checkout's in it (see `seedTestCoverage`). So a
 * worktree's first partial run carries the base's `standing` forward, assumed
 * entries included, and leaves it absent when the base had no record to copy.
 */
function standingAfter(
  prior: RecordedTests | undefined,
  held: CommitRuns | undefined,
  base: string | undefined,
  ran: readonly string[],
): CommitRuns['standing'] {
  // No snapshot under these probes: the run replaced it, and holds only its own.
  if (prior === undefined) return [];
  const observed = new Set(ran);
  const unobserved = prior.tests.map((test) => test.file).filter((test) => !observed.has(test));
  if (unobserved.length === 0) return [];
  if (base === undefined || held?.commit !== base) return undefined;
  // A stand is a commit and whether it was assumed there; the key is both.
  const key = (commit: string, assumed: boolean): string => `${assumed ? 'assumed' : 'observed'} ${commit}`;
  const stands = new Map<string, Stand>();
  const listed = new Map<string, string>();
  for (const entry of held.standing ?? []) {
    const at = key(entry.commit, entry.assumed === true);
    stands.set(at, { commit: entry.commit, files: [], ...(entry.assumed ? { assumed: true } : {}) });
    for (const file of entry.files) listed.set(file, at);
  }
  // Earliest landing first: the record's own order, then the start it names,
  // then its own commit, which landed after every other. That is not oldest
  // first when a run landed at a commit older than the one before it.
  const start = held.over === undefined ? undefined : key(held.over, true);
  if (start !== undefined && !stands.has(start)) stands.set(start, { commit: held.over!, files: [], assumed: true });
  if (!stands.has(key(base, false))) stands.set(key(base, false), { commit: base, files: [] });
  const ranThere = new Set(held.files);
  const grouped = new Map<string, string[]>();
  for (const test of unobserved) {
    const at = ranThere.has(test) ? key(base, false) : (listed.get(test) ?? start);
    if (at === undefined) return undefined;
    grouped.set(at, [...(grouped.get(at) ?? []), test]);
  }
  return [...stands]
    .filter(([at]) => grouped.has(at))
    .map(([at, stand]) => ({ ...stand, files: [...new Set(grouped.get(at))].sort(codeUnitOrder) }));
}

/** The runs recorded into the snapshot at `coverageFile`, or `undefined` when no run has listed itself. */
export async function readCommitRuns(coverageFile: string): Promise<CommitRuns | undefined> {
  let text: string;
  try {
    text = await readFile(commitRunsFile(coverageFile), 'utf8');
  } catch {
    return undefined;
  }
  return JSON.parse(text) as CommitRuns;
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
