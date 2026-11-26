// compass: variance-authority.reach
/**
 * The records the merge queue kept for the commit a push to the mainline
 * landed.
 *
 * GitHub's merge queue tests the commit that lands, so the green
 * `merge_group` run of the same workflow at `HEAD` holds the record of every
 * test the change reached, already run. Its shards upload their records as
 * artifacts, and the GitHub CLI, which already holds the job's token,
 * downloads them. The run is matched by its workflow file, its event, its
 * commit and its conclusion, never by a name: a run of another workflow, of
 * another commit or one that failed is not the queue's word on this commit.
 * A queue's run that kept no record leaves the pull request's run of the same
 * tree to read.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperatorError } from '../exit.js';
import type { Env } from '../share-lines.js';
import { gitIn, short, spelling } from './carry-merge.js';
import { gh, ghFailed, type Gh } from './gh.js';

export interface QueueRequest {
  readonly root: string;
  /** The artifact names the shards uploaded, as `gh run download --pattern` reads them. */
  readonly pattern: string;
  /** The commit the push landed, which the queue tested. */
  readonly commit: string;
  readonly env: Env;
}

/** The request, with the repository and the workflow file the running workflow names. */
interface Asked extends QueueRequest {
  readonly repo: string;
  /** The workflow file, as a run's `path` names it. */
  readonly path: string;
}

interface WorkflowRun {
  readonly id: number;
  readonly path: string;
  readonly status: string;
  readonly conclusion: string | null;
}

/**
 * A run that may have tested the landed tree: the event and commit it ran at,
 * what to say when no green run did, and, when its records name a commit other
 * than the landed one, the proof that the run's tree is the landed tree.
 */
/** The commit a run's records name, what it was made of, and the line that says where they came from. */
interface Proof {
  readonly tested: string;
  readonly madeOf: string;
  readonly from: string;
}

interface Witness {
  readonly event: string;
  readonly commit: string;
  readonly missing: string;
  readonly prove?: (id: string) => Promise<Proof | { readonly none: string }>;
}

/**
 * A directory holding the shards' records, which the caller removes, and where
 * they came from when it was not the queue; or why there is none. The runs
 * that may have tested the landed tree are read in turn: the merge queue's,
 * which tested the landed commit itself, then the pull request's at the
 * landed merge's head, whose records are stated at the landed commit.
 */
export async function recordsFromQueue(
  request: QueueRequest,
  exec: Gh = gh,
): Promise<{ readonly dir: string; readonly from?: string } | { readonly none: string }> {
  const repo = request.env['GITHUB_REPOSITORY'];
  const ref = request.env['GITHUB_WORKFLOW_REF'];
  if (repo === undefined || ref === undefined || !ref.startsWith(`${repo}/`)) {
    return { none: '`--from-queue` reads the merge queue of the workflow running it, and GITHUB_REPOSITORY and GITHUB_WORKFLOW_REF are not set' };
  }
  // `owner/repo/.github/workflows/check.yml@refs/heads/main`: the run's `path` is the part between.
  const asked = { ...request, repo, path: ref.slice(repo.length + 1).replace(/@.*$/u, '') };
  const refused: string[] = [];
  // The pull request's witness is made only once the queue's refused: it costs git work the queue's path never needs.
  for (const witness of [async () => ({ event: 'merge_group', commit: asked.commit, missing: `no green merge-queue run of ${asked.path} tested ${asked.commit}` }), () => headWitness(asked)]) {
    const made: Witness | { readonly none: string } = await witness();
    const got = 'none' in made ? made : await witnessed(asked, made, exec);
    if ('dir' in got) return got;
    refused.push(got.none);
  }
  return { none: refused.join('; ') };
}

/**
 * The pull request's run as a witness, or why there is none. That run tested
 * the head, the landed merge's second parent, merged with the record's commit
 * (`carry merge`). The head merged with the first parent must be the landed
 * tree, and each record must name `carry merge`'s merge of the two, made again
 * here: the hash proves the run merged with that parent alone.
 */
async function headWitness(asked: Asked): Promise<Witness | { readonly none: string }> {
  const inRoot = gitIn(asked.root, {});
  const git = (...args: string[]) => inRoot(args).then(({ stdout }) => stdout.trim());
  const parent = (n: number) => git('rev-parse', '--verify', '--quiet', `${asked.commit}^${n}`).catch(() => undefined);
  const [first, head] = await Promise.all([parent(1), parent(2)]);
  if (first === undefined || head === undefined) return { none: `${short(asked.commit)} is not a merge, so no pull request's run tested its change` };
  return {
    event: 'pull_request',
    commit: head,
    missing: `no green pull_request run of ${asked.path} tested its head ${short(head)}`,
    prove: async (id) => {
      const landed = await git('rev-parse', `${asked.commit}^{tree}`);
      // A conflict exits non-zero and names no tree that could have landed.
      const merged = await git('merge-tree', '--write-tree', first, head).then((out) => out.split('\n')[0], () => undefined);
      if (merged !== landed) return { none: `${short(head)} merged with ${short(first)} is not the tree ${short(asked.commit)} landed, so run ${id} tested another change` };
      // `carry merge`'s merge made again without a checkout: every clone makes the same one.
      const spelled = await spelling(inRoot, first, head);
      const tested = (await inRoot(['-c', 'commit.gpgsign=false', 'commit-tree', landed, '-p', first, '-p', head, '-m', spelled.message], spelled.env)).stdout.trim();
      const madeOf = `${short(head)} merged with ${short(first)}`;
      return { tested, madeOf, from: `read from pull request run ${id}, which tested ${madeOf}, the tree ${short(asked.commit)} landed` };
    },
  };
}

/** The records `witness`'s latest green run kept, stated at the landed commit, or why there are none. */
async function witnessed(asked: Asked, witness: Witness, exec: Gh): Promise<{ readonly dir: string; readonly from?: string } | { readonly none: string }> {
  const id = await greenRun(asked, witness.commit, witness.event, exec);
  if (id === undefined) return { none: witness.missing };
  const proof = witness.prove === undefined ? undefined : await witness.prove(id);
  if (proof !== undefined && 'none' in proof) return proof;
  const got = await downloaded(asked, id, exec);
  if ('none' in got || proof === undefined) return got;
  try {
    const refused = await restated(got.dir, proof.tested, asked.commit);
    if (refused === undefined) return { dir: got.dir, from: proof.from };
    await rm(got.dir, { recursive: true, force: true });
    return { none: `run ${id} did not test ${proof.madeOf}: ${refused}` };
  } catch (error) {
    await rm(got.dir, { recursive: true, force: true });
    throw error;
  }
}

/** Every record in `dir` restated from `tested` at `landed`, or why one cannot be: none is there, or one was made elsewhere. */
async function restated(dir: string, tested: string, landed: string): Promise<string | undefined> {
  const { cachedSuite } = await import('@variance-authority/sense/test-selection');
  // bound: the files of the artifacts one run uploaded, downloaded into this directory alone.
  const files = (await readdir(dir, { recursive: true })).map((path) => join(dir, path)).filter((path) => cachedSuite(path) !== undefined);
  if (files.length === 0) return "its artifacts hold no record";
  for (const file of files) {
    const done = await restateRecord(file, tested, landed);
    if ('madeAt' in done) return `${file.slice(dir.length + 1)} was made at ${done.madeAt ?? 'no commit'}, not at ${short(tested)}`;
  }
  return undefined;
}

/**
 * A record made at one commit, stated at another commit of the same tree: the
 * pull request's run tested a merge no ref holds, and the landed commit holds
 * the same texts. The caller proves the trees equal; this rewrites names and
 * nothing it observed.
 *
 * State the record at `coverageFile`, made at `from`, at `to`: its coverage's
 * commit, its last run's, and every commit its runs record names that is
 * `from`. A record of cases without coverage is made where its last run says.
 * A record made at another commit, or at none, is left as it is, and the
 * answer names where it was made.
 */
export async function restateRecord(coverageFile: string, from: string, to: string): Promise<{ readonly restated: true } | { readonly madeAt: string | undefined }> {
  const { caseSectionsOf, commitRunsFile, decodeTestCoverage, encodeTestCoverage, readCommitRuns, RecordWithoutCoverage, withCaseSections, writeCommitRuns, writeCoverageBytes } = await import('@variance-authority/sense/test-selection');
  const bytes = await readFile(coverageFile);
  const sections = caseSectionsOf(bytes);
  const run = sections.last === undefined ? undefined : (JSON.parse(Buffer.from(sections.last).toString('utf8')) as { commit?: string; before?: string });
  let coverage: ReturnType<typeof decodeTestCoverage> | undefined;
  try {
    coverage = decodeTestCoverage(bytes);
  } catch (error) {
    if (!(error instanceof RecordWithoutCoverage)) throw error;
  }
  const madeAt = coverage === undefined ? run?.commit : coverage.commit;
  if (madeAt !== from) return { madeAt };
  const at = (commit: string): string => (commit === from ? to : commit);

  const last = run === undefined ? undefined : Buffer.from(JSON.stringify({ ...run, ...(run.commit === undefined ? {} : { commit: at(run.commit) }), ...(run.before === undefined ? {} : { before: at(run.before) }) }));
  const record = coverage === undefined ? bytes : encodeTestCoverage({ ...coverage, commit: to });
  await writeCoverageBytes(coverageFile, withCaseSections(record, { ...sections, ...(last === undefined ? {} : { last }) }));
  const runs = await readCommitRuns(coverageFile);
  if (runs !== undefined) {
    await writeCommitRuns(commitRunsFile(coverageFile), {
      ...runs,
      ...(runs.commit === undefined ? {} : { commit: at(runs.commit) }),
      ...(runs.over === undefined ? {} : { over: at(runs.over) }),
      ...(runs.standing === undefined ? {} : { standing: runs.standing.map((entry) => ({ ...entry, commit: at(entry.commit) })) }),
    });
  }
  return { restated: true };
}

/** The latest green run of the workflow at `commit` under `event`, or none. */
async function greenRun(asked: Asked, commit: string, event: string, exec: Gh): Promise<string | undefined> {
  const api = `repos/${asked.repo}/actions/runs?head_sha=${commit}&event=${event}&per_page=100`;
  let listed: { readonly stdout: string };
  try {
    listed = await exec(['api', api], { cwd: asked.root });
  } catch (error) {
    throw new OperatorError(ghFailed(error, `gh api ${api}`, '--from-queue'));
  }
  const runs = (JSON.parse(listed.stdout) as { readonly workflow_runs: readonly WorkflowRun[] }).workflow_runs;
  const green = runs.filter((each) => each.path === asked.path && each.status === 'completed' && each.conclusion === 'success');
  // A commit run again keeps its latest run's word.
  return green.length === 0 ? undefined : String(Math.max(...green.map((each) => each.id)));
}

/** A directory of the artifacts run `id` kept by the pattern, which the caller removes, or why there is none. */
async function downloaded(asked: Asked, id: string, exec: Gh): Promise<{ readonly dir: string } | { readonly none: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'variance-from-queue-'));
  try {
    await exec(['run', 'download', id, '--repo', asked.repo, '--pattern', asked.pattern, '--dir', dir], { cwd: asked.root });
    return { dir };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    return { none: `run ${id} kept no artifact named ${asked.pattern}: ${ghFailed(error, `gh run download ${id}`, '--from-queue')}` };
  }
}
