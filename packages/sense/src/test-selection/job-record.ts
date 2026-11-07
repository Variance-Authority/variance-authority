// compass: variance-authority.reach
/**
 * A job in the record: one row whose preconditions are what it read.
 *
 * A build has no test cases and no probes, but what selection asks of it is what
 * it asks of a test: did this change reach something it depended on. A row with
 * no modules and a precondition per input already answers that, so a job needs
 * no format of its own: each file it read is a precondition, by its blob.
 *
 * What it wrote is no input. Those files are named in a file beside the record,
 * for a later step of the same job to leave out and for a cache to restore. A job
 * of several commands lands each into the same row, at one commit.
 *
 * A run that found its output current reads next to nothing, and it cannot be told
 * from a run that needs little: what a job read stays an input until the record
 * goes, each at its blob now. A file the job stopped reading selects it needlessly;
 * a file dropped by a warm run would skip it wrongly.
 */

import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { INSTRUMENTATION_ID } from '../instrument/identity.js';
import { commitRunsAfter, commitRunsFile, heldCommitRuns, recordedSnapshot, writeCommitRuns } from './commit-runs.js';
import { decodeTestCoverage } from './format.js';
import { busyIndex, withIndexLock } from './index-lock.js';
import { insideRoot, projectPath } from './instrumented-modules.js';
import type { JobTrace } from './job-trace.js';
import { testCoverageFile, writeCoverageBytes } from './record-location.js';
import { writeTestCoverage } from './index.js';

/** One command of a job, finished. */
export interface JobStep {
  readonly root: string;
  readonly suite: string;
  readonly commit: string;
  /** Whether the command exited clean. A job that failed read an unknown part of what it would have. */
  readonly complete: boolean;
  readonly trace: JobTrace;
  /** Each tracked path and its blob: a change can only move a tracked file, so only those are selected on. */
  readonly tracked: ReadonlyMap<string, string>;
  /** Tracked files that differed from `commit` when the command started: what it read of them is no blob of this commit. */
  readonly edited: ReadonlySet<string>;
}

/** What a job's commands wrote at `commit`, by name from the repository's root. */
export interface JobWrites {
  readonly commit: string;
  readonly writes: readonly string[];
}

/** `path` from the repository's root; undefined outside it, and inside `.git`. */
function withinRepository(path: string, root: string): string | undefined {
  if (!insideRoot(root, path)) return undefined;
  const name = projectPath(root, path);
  return name === '.git' || name.startsWith('.git/') ? undefined : name;
}

/** Where the writes of the job recorded at `coverageFile` are kept. */
const jobWritesFile = (coverageFile: string): string => `${coverageFile.replace(/\.bin$/, '')}.writes.json`;

/** The writes kept beside `coverageFile`, undefined when there are none. */
export async function readJobWrites(coverageFile: string): Promise<JobWrites | undefined> {
  const text = await readFile(jobWritesFile(coverageFile), 'utf8').catch(() => undefined);
  return text === undefined ? undefined : (JSON.parse(text) as JobWrites);
}

/**
 * Land `step` into its job's record, or refuse: a step lost to another writer would
 * leave a short record under a clean exit, and a short record skips a job wrongly.
 *
 * The record is written whole rather than by `landRun`, which keeps a test by the
 * modules it entered, and a job enters none. So nothing of a record under other
 * probes survives this, and there is no base to lay under it.
 */
export async function landJob(step: JobStep): Promise<void> {
  const file = testCoverageFile(step.root, { suite: step.suite });
  const landed = await withIndexLock(file, () => land(file, step));
  if (!landed.held) throw new Error(busyIndex(file));
}

async function land(file: string, step: JobStep): Promise<void> {
  const { root, suite, commit, complete, trace, tracked, edited } = step;
  const before = await recordedSnapshot(file);
  const runs = await heldCommitRuns(file);
  const held = await heldAt(file, commit, suite);
  const made = new Set(held.writes);
  const inputs = new Map<string, string>();
  for (const { name } of held.row?.preconditions ?? []) {
    const blob = tracked.get(name);
    if (blob !== undefined) inputs.set(name, blob);
  }
  let whole = complete && (!held.here || (held.row?.complete ?? true));
  for (const path of trace.reads) {
    const name = withinRepository(path, root);
    const blob = name === undefined ? undefined : tracked.get(name);
    if (name === undefined || blob === undefined || made.has(name)) continue;
    inputs.set(name, blob);
    if (edited.has(name)) whole = false;
  }
  for (const name of await writesOf(step)) made.add(name);

  const row = {
    file: suite,
    complete: whole,
    preconditions: [...inputs].map(([name, digest]) => ({ name, digest })).sort((one, other) => codeUnitOrder(one.name, other.name)),
  };
  // Whose probes a row entered, and a job's entered none: naming this build's
  // keeps a reader from calling the record another instrumentation's.
  await writeTestCoverage(file, { version: 3, instrumentation: INSTRUMENTATION_ID, commit, tests: [row], modules: [] });
  const kept: JobWrites = { commit, writes: [...made].sort(codeUnitOrder) };
  await writeCoverageBytes(jobWritesFile(file), Buffer.from(`${JSON.stringify(kept)}\n`));
  await writeCommitRuns(commitRunsFile(file), commitRunsAfter(before, runs, { commit, instrumentation: INSTRUMENTATION_ID, tests: [row], laid: 'none' }));
}

/** The job's row as it stands, and whether it stands at `commit`, where its writes and its verdict are this run's too. */
async function heldAt(file: string, commit: string, suite: string) {
  const bytes = await readFile(file).catch(() => undefined);
  const record = bytes === undefined ? undefined : decodeTestCoverage(bytes);
  const row = record?.tests.find((test) => test.file === suite);
  if (record?.commit !== commit) return { row, here: false, writes: [] };
  const writes = await readJobWrites(file);
  return { row, here: true, writes: writes?.commit === commit ? writes.writes : [] };
}

/** The files `step` wrote that are still there. A temporary file a job removed is no output of it. */
async function writesOf({ root, trace }: JobStep): Promise<readonly string[]> {
  const written = await Promise.all([...trace.writes].map(async (path) => {
    const name = withinRepository(path, root);
    if (name === undefined) return undefined;
    return access(join(root, name)).then(() => name, () => undefined);
  }));
  return written.filter((name) => name !== undefined);
}
