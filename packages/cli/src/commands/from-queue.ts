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
 *
 * The queue's run may keep no record: it ran no shard, or failed and was
 * retried. The pull request's own last run tested its head, the landed
 * merge's second parent, merged with the record's commit (`carry merge`).
 * When that head merged with the landed merge's first parent is the tree the
 * push landed, that run tested this tree, and its records are read instead.
 * Its records must name the merge `carry merge` makes of those two parents,
 * made again here: the hash proves the run merged the head with that parent
 * and no other. Each record is then stated at the landed commit. A different
 * tree, another merge, no green run or no shard reads nothing, and says which.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { OperatorError } from '../exit.js';
import type { Env } from '../share-lines.js';
import { remadeMerge, short } from './carry-merge.js';
import { gh, ghFailed, type Gh } from './gh.js';

const run = promisify(execFile);

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
 * A directory holding the shards' records, which the caller removes, and where
 * they came from when it was not the queue; or why there is none.
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
  const id = await greenRun(asked, request.commit, 'merge_group', exec);
  const queued = id === undefined ? { none: `no green merge-queue run of ${asked.path} tested ${request.commit}` } : await downloaded(asked, id, exec);
  if ('dir' in queued) return queued;
  const head = await recordsFromHead(asked, exec);
  return 'none' in head ? { none: `${queued.none}; ${head.none}` } : head;
}

/**
 * The records the pull request's run kept, stated at the landed commit, with
 * the line that says where they came from; or why there are none.
 */
async function recordsFromHead(asked: Asked, exec: Gh): Promise<{ readonly dir: string; readonly from: string } | { readonly none: string }> {
  const git = (...args: string[]) => run('git', args, { cwd: asked.root }).then(({ stdout }) => stdout.trim());
  const parent = (n: number) => git('rev-parse', '--verify', '--quiet', `${asked.commit}^${n}`).catch(() => undefined);
  const [first, head] = await Promise.all([parent(1), parent(2)]);
  if (first === undefined || head === undefined) return { none: `${short(asked.commit)} is not a merge, so no pull request's run tested its change` };
  const id = await greenRun(asked, head, 'pull_request', exec);
  if (id === undefined) return { none: `no green pull_request run of ${asked.path} tested its head ${short(head)}` };

  const landed = await git('rev-parse', `${asked.commit}^{tree}`);
  // A conflict exits non-zero and names no tree that could have landed.
  const merged = await git('merge-tree', '--write-tree', first, head).then((out) => out.split('\n')[0], () => undefined);
  if (merged !== landed) return { none: `${short(head)} merged with ${short(first)} is not the tree ${short(asked.commit)} landed, so run ${id} tested another change` };
  const tested = await remadeMerge(asked.root, first, head, landed);

  const got = await downloaded(asked, id, exec);
  if ('none' in got) return got;
  const { cachedSuite, restateRecord } = await import('@variance-authority/sense/test-selection');
  // bound: the files of the artifacts one run uploaded, downloaded into this directory alone.
  const files = (await readdir(got.dir, { recursive: true })).map((path) => join(got.dir, path)).filter((path) => cachedSuite(path) !== undefined);
  for (const file of files) {
    const done = await restateRecord(file, tested, asked.commit);
    if ('madeAt' in done) {
      await rm(got.dir, { recursive: true, force: true });
      return { none: `run ${id} did not test ${short(head)} merged with ${short(first)}: ${file.slice(got.dir.length + 1)} was made at ${done.madeAt ?? 'no commit'}, not at ${short(tested)}` };
    }
  }
  return { dir: got.dir, from: `read from pull request run ${id}, which tested ${short(head)} merged with ${short(first)}, the tree ${short(asked.commit)} landed` };
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
