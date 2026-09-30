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
   * with its test files in code-unit order. A test in `files` is not listed. A
   * record written before this field has none; its reader takes `over` as where
   * every test outside `files` stands.
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
  const held = await readCommitRuns(coverageFile);
  await writeCoverageBytes(coverageFile, await layeredCoverage(coverageFile, current, root));
  const at = new Date().toISOString();
  const files = current.tests.map((test) => test.file);
  // The snapshot already stands at this commit and the record says what it
  // stood at before: this run is one more at the commit, not a new change.
  const again = current.commit !== undefined && stood === current.commit && held?.commit === current.commit;
  const over = again ? held.over : stood;
  const ran = again ? [...new Set([...held.files, ...files])].sort(codeUnitOrder) : files;
  const standing = current.commit === undefined ? [] : standingAfter(prior, held, current.commit, ran);
  const record: CommitRuns = {
    ...(current.commit === undefined ? {} : { commit: current.commit }),
    ...(over === undefined ? {} : { over }),
    first: again ? held.first : at,
    latest: at,
    runs: again ? held.runs + 1 : 1,
    files: ran,
    ...(current.commit === undefined ? {} : { standing }),
  };
  await writeCoverageBytes(commitRunsFile(coverageFile), Buffer.from(`${JSON.stringify(record, null, 2)}\n`));
}

/**
 * Where each test the snapshot held before this run last ran, leaving out the
 * tests the runs at `commit` observed.
 *
 * The record `held` speaks for the snapshot only when it names the commit that
 * snapshot stood at; otherwise every test in it stands there. A record written
 * before `standing` existed answers with `over` for every test outside its
 * files, which is what its reader took it to mean.
 */
function standingAfter(
  prior: { readonly commit: string | undefined; readonly tests: readonly string[] } | undefined,
  held: CommitRuns | undefined,
  commit: string,
  ran: readonly string[],
): NonNullable<CommitRuns['standing']> {
  const stood = prior?.commit;
  if (prior === undefined || stood === undefined) return [];
  const speaks = held?.commit === stood ? held : undefined;
  const listed = new Map<string, string>();
  for (const entry of speaks?.standing ?? []) for (const file of entry.files) listed.set(file, entry.commit);
  const ranThere = new Set(speaks?.files);
  const standOf = (test: string): string =>
    ranThere.has(test) ? stood : (listed.get(test) ?? speaks?.over ?? stood);
  // Oldest first: the record's own order, then where its runs started, then the
  // commit it named. `over` can be younger than a commit in `standing` — a test
  // two partial runs back — but never older.
  const order = [...new Set([...(speaks?.standing ?? []).map((entry) => entry.commit), ...(speaks?.over === undefined ? [] : [speaks.over]), stood])];
  const observed = new Set(ran);
  const grouped = new Map<string, string[]>();
  for (const test of prior.tests) {
    if (observed.has(test)) continue;
    const stand = standOf(test);
    if (stand === commit) continue;
    grouped.set(stand, [...(grouped.get(stand) ?? []), test]);
  }
  return order
    .filter((stand) => grouped.has(stand))
    .map((stand) => ({ commit: stand, files: [...new Set(grouped.get(stand))].sort(codeUnitOrder) }));
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
