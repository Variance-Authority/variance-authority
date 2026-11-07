// compass: variance-authority.reach
/**
 * A job in the record: one row whose preconditions are what it read.
 *
 * A build has no test cases and no probes, but what selection asks of it is what
 * it asks of a test: did this change reach something it depended on. A row with
 * no modules and a precondition per input already answers that, so a job needs
 * no format of its own. Three names say three things:
 *
 * - `a.txt`, digest the blob: the job read this file.
 * - `pages/`, digest `listed`: the job listed this folder, so a file appearing
 *   in it is news (`listingOf`). `./` is the root.
 * - `x.json`, digest `absent`: the job looked here and found nothing, so a file
 *   appearing here is news.
 *
 * What it wrote is no input. Those files are kept beside the record by their
 * content, for a later step of the same job to leave out and for a cache to
 * restore. A job of several commands lands each into the same row, at one commit.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { digestBytes } from '../digest.js';
import { INSTRUMENTATION_ID } from '../instrument/identity.js';
import { commitRunsFile, readCommitRuns, writeCommitRuns } from './commit-runs.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import type { JobTrace } from './job-trace.js';
import { testCoverageFile, writeCoverageBytes } from './record-location.js';
import { listingOf } from './select.js';
import type { CoveragePrecondition } from './index.js';

/** One command of a job, finished. `inputs` is {@link jobInputs}'s answer for its trace. */
export interface JobStep {
  readonly root: string;
  readonly suite: string;
  readonly commit: string;
  /** Whether the command exited clean. A job that failed read an unknown part of what it would have. */
  readonly complete: boolean;
  readonly at: string;
  readonly inputs: readonly CoveragePrecondition[];
  readonly trace: Pick<JobTrace, 'writes'>;
}

/** What a job's commands wrote at `commit`, each by the digest of its content when the command ended. */
export interface JobWrites {
  readonly commit: string;
  readonly writes: readonly CoveragePrecondition[];
}

/**
 * The preconditions of `trace`. Only what the repository holds is selected on: a
 * change can only move a tracked file, and a file outside the checkout is the
 * machine's. `tracked` maps each tracked path to its blob; `ignored` answers
 * which of the names it is given the repository ignores, which is how a module
 * lookup's many misses under `node_modules` stay out of the record.
 */
export function jobInputs(
  trace: Pick<JobTrace, 'reads' | 'absent'>,
  root: string,
  tracked: ReadonlyMap<string, string>,
  ignored: (names: readonly string[]) => ReadonlySet<string>,
): readonly CoveragePrecondition[] {
  const folders = new Set(['./']);
  for (const file of tracked.keys()) {
    for (let folder = listingOf(file); folder !== './'; folder = listingOf(folder.slice(0, -1))) {
      if (folders.has(folder)) break;
      folders.add(folder);
    }
  }
  const inputs = new Map<string, string>();
  for (const path of trace.reads) {
    const name = withinRepository(path, root);
    if (name === undefined) continue;
    const blob = tracked.get(name);
    if (blob !== undefined) inputs.set(name, blob);
    else if (folders.has(`${name}/`)) inputs.set(`${name}/`, 'listed');
    else if (name === '') inputs.set('./', 'listed');
  }
  const missing = [...trace.absent].flatMap((path) => {
    const name = withinRepository(path, root);
    return name === undefined || name === '' || tracked.has(name) ? [] : [name];
  });
  const skipped = missing.length === 0 ? new Set<string>() : ignored(missing);
  for (const name of missing) if (!skipped.has(name)) inputs.set(name, 'absent');
  return byName([...inputs].map(([name, digest]) => ({ name, digest })));
}

/** `path` from the repository's root, `''` for the root itself; undefined outside it, and inside `.git`. */
function withinRepository(path: string, root: string): string | undefined {
  if (path === root) return '';
  if (!path.startsWith(`${root}/`)) return undefined;
  const name = path.slice(root.length + 1);
  return name === '.git' || name.startsWith('.git/') ? undefined : name;
}

const byName = <Named extends { readonly name: string }>(entries: readonly Named[]): readonly Named[] =>
  [...entries].sort((one, other) => (one.name < other.name ? -1 : one.name > other.name ? 1 : 0));

/** Where the writes of the job recorded at `coverageFile` are kept. */
export function jobWritesFile(coverageFile: string): string {
  return commitRunsFile(coverageFile).replace(/\.runs\.json$/, '.writes.json');
}

/** The writes kept beside `coverageFile`, undefined when there are none. */
export async function readJobWrites(coverageFile: string): Promise<JobWrites | undefined> {
  const text = await readFile(jobWritesFile(coverageFile), 'utf8').catch(() => undefined);
  return text === undefined ? undefined : (JSON.parse(text) as JobWrites);
}

/**
 * Land `step` into its job's record. The record is written whole rather than by
 * `landRun`, which keeps a test by the modules it entered, and a job enters none.
 * The run beside it is what lets `share --publish` call the commit's run whole.
 */
export async function landJob(step: JobStep): Promise<void> {
  const { root, suite, commit, complete, at } = step;
  const file = testCoverageFile(root, { suite });
  const held = await heldAt(file, commit, suite);
  const made = new Set(held.writes.map(({ name }) => name));
  const inputs = new Map(held.row?.preconditions.map(({ name, digest }) => [name, digest]));
  for (const { name, digest } of step.inputs) if (!made.has(name)) inputs.set(name, digest);
  const writes = new Map(held.writes.map(({ name, digest }) => [name, digest]));
  for (const { name, digest } of await writesOf(step)) writes.set(name, digest);

  await mkdir(dirname(file), { recursive: true });
  await writeCoverageBytes(file, encodeTestCoverage({
    version: 3,
    // Whose probes a row entered, and a job's entered none: naming this build's
    // keeps a reader from calling the record another instrumentation's.
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: [{
      file: suite,
      complete: complete && (held.row?.complete ?? true),
      preconditions: byName([...inputs].map(([name, digest]) => ({ name, digest }))),
    }],
    modules: [],
  }));
  const kept: JobWrites = { commit, writes: byName([...writes].map(([name, digest]) => ({ name, digest }))) };
  await writeFile(jobWritesFile(file), `${JSON.stringify(kept)}\n`);
  const first = held.first ?? at;
  await writeCommitRuns(commitRunsFile(file), {
    commit,
    latest: at,
    runs: 1,
    landings: [{ files: [suite], first, latest: at, runs: 1 }],
    standing: [],
  });
}

/** What the job's earlier commands left at `commit`; nothing, when the record stands elsewhere. */
async function heldAt(file: string, commit: string, suite: string) {
  const bytes = await readFile(file).catch(() => undefined);
  const record = bytes === undefined ? undefined : decodeTestCoverage(bytes);
  if (record?.commit !== commit) return { row: undefined, writes: [], first: undefined };
  const writes = await readJobWrites(file);
  const runs = await readCommitRuns(file);
  return {
    row: record.tests.find((test) => test.file === suite),
    writes: writes?.commit === commit ? writes.writes : [],
    first: runs?.commit === commit ? runs.landings[0]?.first : undefined,
  };
}

/** The files `step` wrote that are still there, by their content. A temporary file a job removed is no output of it. */
async function writesOf({ root, trace }: JobStep): Promise<readonly CoveragePrecondition[]> {
  const written = await Promise.all([...trace.writes].map(async (path) => {
    const name = withinRepository(path, root);
    if (name === undefined || name === '') return undefined;
    const bytes = await readFile(join(root, name)).catch(() => undefined);
    return bytes === undefined ? undefined : { name, digest: digestBytes(bytes) as string };
  }));
  return written.filter((entry) => entry !== undefined);
}
