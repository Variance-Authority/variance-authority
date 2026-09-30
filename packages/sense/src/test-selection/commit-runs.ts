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
 * because once a run lands, the snapshot no longer says. A record that cannot
 * be carried forward — none beside the snapshot, one naming another commit, one
 * with no `standing` of its own — leaves `standing` absent rather than guessed,
 * until a run observes every test and there is nothing left to say.
 *
 * Written beside the snapshot, and by every writer of the snapshot rather than
 * by one seam: which runner recorded a run is not a question its reader should
 * have to ask. A landing of shard snapshots is one of those writers. Its fold is
 * one run of the suite at the shards' commit, and the shards name the test files
 * they ran, so it is recorded by the same rules as a run.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { askCoverageFile } from './coverage-file.js';
import { layeredCoverage } from './format-layer.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { writeCoverageBytes, type TestCoverage } from './index.js';

/**
 * One commit's runs, as `coverage.runs.json` holds them: what a review reads to
 * know where a change starts and which test files ran for it.
 */
export interface CommitRuns {
  /** The commit the runs were recorded at. Absent outside a checkout, where every run starts the record again. */
  readonly commit?: string;
  /**
   * The commit of the snapshot the first of these runs was laid over: where a
   * reading of the change they ran for starts. Absent when there was no
   * snapshot, when it named no commit, when it was recorded by other probes
   * and so was replaced rather than laid over, or when git says these runs'
   * commit does not descend from it.
   */
  readonly over?: string;
  /** When the first and the latest of the runs landed. */
  readonly first: string;
  readonly latest: string;
  /** How many runs landed at this commit. */
  readonly runs: number;
  /** Every test file the runs observed, in code-unit order. */
  readonly files: readonly string[];
  /**
   * The commit each other test in the snapshot last ran at, oldest first, each
   * with its test files in code-unit order. A test in `files` is not listed.
   * Absent when the run that wrote this record could not know: the record it
   * replaced did not speak for the snapshot the run was laid over. A reader
   * that falls back, to `over` or to `commit`, says it did.
   */
  readonly standing?: readonly { readonly commit: string; readonly files: readonly string[] }[];
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
  await writeCommitRuns(commitRunsFile(coverageFile), await commitRunsAfter(before, held, current, root));
}

/**
 * The runs record once `current` is laid over the snapshot `before`, where
 * `held` is the record beside that snapshot.
 *
 * The test files are `current`'s own, as its runner recorded them. Nothing here
 * works them out again. A snapshot under other probes is replaced rather than
 * laid over, so it is no base: the record then names none.
 *
 * Nor is a snapshot at a commit `current`'s does not descend from. A review
 * reads `over` as where the change these runs ran for starts, and diffs from
 * it. Main's shards landed over a branch's snapshot, or a run after checking
 * out an older commit, would name the branch's commit as that start, and the
 * review would silently leave out every commit of the branch before it. So
 * `over` is named only when `current`'s commit descends from the snapshot's,
 * and git, asked in `root`, is what says so. When git cannot say — no
 * checkout, a commit this clone does not hold — `over` is named as before: a
 * reader that diffs from it asks the same history, and says it could not.
 *
 * {@link landRun} reads both inputs off the disk. A landing of shard snapshots
 * has already read the snapshot to merge over it, and passes that.
 */
export async function commitRunsAfter(
  before: RecordedTests | undefined,
  held: CommitRuns | undefined,
  current: RecordedTests,
  root: string,
): Promise<CommitRuns> {
  const prior = before?.instrumentation === current.instrumentation ? before : undefined;
  const stood = prior?.commit;
  const at = new Date().toISOString();
  const files = current.tests.map((test) => test.file);
  // The snapshot already stands at this commit and the record says what it
  // stood at before: this run is one more at the commit, not a new change.
  const again = current.commit !== undefined && stood === current.commit && held?.commit === current.commit;
  const over = again ? held.over : (await descends(root, stood, current.commit)) === false ? undefined : stood;
  const ran = again ? [...new Set([...held.files, ...files])].sort(codeUnitOrder) : files;
  const standing = current.commit === undefined ? undefined : standingAfter(prior, held, current.commit, ran);
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
 * tests the runs at `commit` observed, or `undefined` when that is not known.
 *
 * Only the record `held` knows, and only when it names the commit the snapshot
 * stood at and carries `standing` of its own: a test in its `files` stood
 * there, and every other test is listed. Anything short of that — no record, a
 * record of another commit, one written before `standing`, a test it does not
 * list — is not known, and a guess written here would be read back as a fact at
 * every run after this one. So the answer is absent until a run observes every
 * test the snapshot held, which needs no record at all.
 *
 * A worktree's first run is laid over a copy of the primary checkout's
 * snapshot, and the record beside it is the worktree's own, which does not
 * exist yet: the primary checkout's runs describe its change, not this one. So
 * a worktree's first partial run leaves `standing` absent too.
 */
function standingAfter(
  prior: RecordedTests | undefined,
  held: CommitRuns | undefined,
  commit: string,
  ran: readonly string[],
): CommitRuns['standing'] {
  // No snapshot under these probes: the run replaced it, and holds only its own.
  if (prior === undefined) return [];
  const observed = new Set(ran);
  const unobserved = prior.tests.map((test) => test.file).filter((test) => !observed.has(test));
  if (unobserved.length === 0) return [];
  const stood = prior.commit;
  if (stood === undefined || held?.commit !== stood || held.standing === undefined) return undefined;
  const listed = new Map<string, string>();
  for (const entry of held.standing) for (const file of entry.files) listed.set(file, entry.commit);
  const ranThere = new Set(held.files);
  const grouped = new Map<string, string[]>();
  for (const test of unobserved) {
    const stand = ranThere.has(test) ? stood : listed.get(test);
    if (stand === undefined) return undefined;
    if (stand === commit) continue;
    grouped.set(stand, [...(grouped.get(stand) ?? []), test]);
  }
  // Oldest first: the record's own order, then the commit it named, which every
  // test in `standing` last ran before.
  const order = [...new Set([...held.standing.map((entry) => entry.commit), stood])];
  return order
    .filter((stand) => grouped.has(stand))
    .map((stand) => ({ commit: stand, files: [...new Set(grouped.get(stand))].sort(codeUnitOrder) }));
}

/**
 * Whether `to` descends from `from`, as git answers it in `root`: `false` when
 * `from` is not in `to`'s history, and `undefined` when git cannot say. Git's
 * exit code is the answer, so it is read directly: 0 is yes, 1 is no, and
 * anything else — no checkout, a commit this clone does not hold — is neither.
 */
async function descends(root: string, from: string | undefined, to: string | undefined): Promise<boolean | undefined> {
  if (from === undefined || to === undefined) return undefined;
  if (from === to) return true;
  return new Promise((resolve) => {
    execFile('git', ['merge-base', '--is-ancestor', from, to], { cwd: root }, (error) =>
      resolve(error === null ? true : error.code === 1 ? false : undefined),
    );
  });
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
