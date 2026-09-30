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
 * have to ask.
 */

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
   * snapshot, when it named no commit, or when it was recorded by other probes
   * and so was replaced rather than laid over.
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
 * Lay `current` over the snapshot, and add it to the runs at its commit.
 *
 * The caller holds the index lock: the base read here, the write after it and
 * the record of both are one read-modify-write, so two processes finishing
 * together each add their files.
 */
export async function landRun(coverageFile: string, current: TestCoverage, root: string): Promise<void> {
  const prior = await standingSnapshot(coverageFile, current.instrumentation);
  const stood = prior?.commit;
  // A record this cannot read is no record to carry forward: the run writes a
  // fresh one, which leaves `standing` absent rather than guessed, and says so.
  const held = await readCommitRuns(coverageFile).catch((error: unknown) => {
    console.warn(
      `variance-authority: ${error instanceof Error ? error.message : String(error)}; this run writes it afresh, ` +
        'so where each test it did not run last ran is not recorded until a run observes every test.',
    );
    return undefined;
  });
  await writeCoverageBytes(coverageFile, await layeredCoverage(coverageFile, current, root));
  const at = new Date().toISOString();
  const files = current.tests.map((test) => test.file);
  // The snapshot already stands at this commit and the record says what it
  // stood at before: this run is one more at the commit, not a new change.
  const again = current.commit !== undefined && stood === current.commit && held?.commit === current.commit;
  const over = again ? held.over : stood;
  const ran = again ? [...new Set([...held.files, ...files])].sort(codeUnitOrder) : files;
  const standing = current.commit === undefined ? undefined : standingAfter(prior, held, current.commit, ran);
  const record: CommitRuns = {
    ...(current.commit === undefined ? {} : { commit: current.commit }),
    ...(over === undefined ? {} : { over }),
    first: again ? held.first : at,
    latest: at,
    runs: again ? held.runs + 1 : 1,
    files: ran,
    ...(standing === undefined ? {} : { standing }),
  };
  await writeCoverageBytes(commitRunsFile(coverageFile), Buffer.from(`${JSON.stringify(record, null, 2)}\n`));
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
 *
 * FIXME: `landJourneys` in `packages/cli/src/commands/land.ts` writes the
 * snapshot without calling `landRun`, so a landing of shard snapshots leaves
 * this record naming the commit before it. The next run here finds a record
 * speaking for another snapshot and writes no `standing`, and a `test:since`
 * before that run reads every test from the landed commit, saying so.
 */
function standingAfter(
  prior: { readonly commit: string | undefined; readonly tests: readonly string[] } | undefined,
  held: CommitRuns | undefined,
  commit: string,
  ran: readonly string[],
): CommitRuns['standing'] {
  // No snapshot under these probes: the run replaced it, and holds only its own.
  if (prior === undefined) return [];
  const observed = new Set(ran);
  const unobserved = prior.tests.filter((test) => !observed.has(test));
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
 * The runs recorded into the snapshot at `coverageFile`, or `undefined` when no
 * run has listed itself: when there is no file at all.
 *
 * A record that is there and cannot be read, or is not a JSON object, throws,
 * naming the file: it says where each test last ran, and a reader that took it
 * for *no record* would place every test at the journal's commit, which can
 * skip a test that should run. Each caller says what the record was for and
 * what to do. A writer, `landRun`, need not refuse: it writes a record that
 * says less, and says so.
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`the runs record at ${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`the runs record at ${file} is not a JSON object`);
  }
  return parsed as CommitRuns;
}

/**
 * The snapshot a run under `instrumentation` is laid over — its commit and its
 * test files — which a snapshot under other probes is not.
 */
async function standingSnapshot(
  coverageFile: string,
  instrumentation: string,
): Promise<{ readonly commit: string | undefined; readonly tests: readonly string[] } | undefined> {
  try {
    return await askCoverageFile(coverageFile, (coverage) =>
      coverage.instrumentation === instrumentation
        ? { commit: coverage.commit, tests: Array.from(coverage.testPath.all(), (path) => coverage.string(path)) }
        : undefined);
  } catch {
    return undefined;
  }
}
