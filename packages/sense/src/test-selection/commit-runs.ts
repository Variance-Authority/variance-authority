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
  const stood = await standingCommit(coverageFile, current.instrumentation);
  const held = await readCommitRuns(coverageFile);
  await writeCoverageBytes(coverageFile, await layeredCoverage(coverageFile, current, root));
  const at = new Date().toISOString();
  const files = current.tests.map((test) => test.file);
  // The snapshot already stands at this commit and the record says what it
  // stood at before: this run is one more at the commit, not a new change.
  const again = current.commit !== undefined && stood === current.commit && held?.commit === current.commit;
  const over = again ? held.over : stood;
  const record: CommitRuns = {
    ...(current.commit === undefined ? {} : { commit: current.commit }),
    ...(over === undefined ? {} : { over }),
    first: again ? held.first : at,
    latest: at,
    runs: again ? held.runs + 1 : 1,
    files: again ? [...new Set([...held.files, ...files])].sort(codeUnitOrder) : files,
  };
  await writeCoverageBytes(commitRunsFile(coverageFile), Buffer.from(`${JSON.stringify(record, null, 2)}\n`));
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

/** The commit a run under `instrumentation` is laid over, which a snapshot under other probes is not. */
async function standingCommit(coverageFile: string, instrumentation: string): Promise<string | undefined> {
  try {
    return await askCoverageFile(coverageFile, (coverage) =>
      coverage.instrumentation === instrumentation ? coverage.commit : undefined);
  } catch {
    return undefined;
  }
}
