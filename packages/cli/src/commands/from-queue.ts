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
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperatorError } from '../exit.js';
import type { Env } from '../share-lines.js';
import { gh, ghFailed, type Gh } from './gh.js';

export interface QueueRequest {
  readonly root: string;
  /** The artifact names the shards uploaded, as `gh run download --pattern` reads them. */
  readonly pattern: string;
  /** The commit the push landed, which the queue tested. */
  readonly commit: string;
  readonly env: Env;
}

interface WorkflowRun {
  readonly id: number;
  readonly path: string;
  readonly status: string;
  readonly conclusion: string | null;
}

/**
 * A directory holding the shards' records, which the caller removes, or why
 * there is none.
 */
export async function recordsFromQueue(request: QueueRequest, exec: Gh = gh): Promise<{ readonly dir: string } | { readonly none: string }> {
  const repo = request.env['GITHUB_REPOSITORY'];
  const ref = request.env['GITHUB_WORKFLOW_REF'];
  if (repo === undefined || ref === undefined || !ref.startsWith(`${repo}/`)) {
    return { none: '`--from-queue` reads the merge queue of the workflow running it, and GITHUB_REPOSITORY and GITHUB_WORKFLOW_REF are not set' };
  }
  // `owner/repo/.github/workflows/check.yml@refs/heads/main`: the run's `path` is the part between.
  const path = ref.slice(repo.length + 1).replace(/@.*$/u, '');
  const api = `repos/${repo}/actions/runs?head_sha=${request.commit}&event=merge_group&per_page=100`;
  let listed: { readonly stdout: string };
  try {
    listed = await exec(['api', api], { cwd: request.root });
  } catch (error) {
    throw new OperatorError(ghFailed(error, `gh api ${api}`, '--from-queue'));
  }
  const runs = (JSON.parse(listed.stdout) as { readonly workflow_runs: readonly WorkflowRun[] }).workflow_runs;
  const green = runs.filter((each) => each.path === path && each.status === 'completed' && each.conclusion === 'success');
  if (green.length === 0) return { none: `no green merge-queue run of ${path} tested ${request.commit}` };
  // A commit the queue ran again keeps its latest run's word.
  const id = String(Math.max(...green.map((each) => each.id)));

  const dir = await mkdtemp(join(tmpdir(), 'variance-from-queue-'));
  try {
    await exec(['run', 'download', id, '--repo', repo, '--pattern', request.pattern, '--dir', dir], { cwd: request.root });
    return { dir };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    return { none: `run ${id} kept no artifact named ${request.pattern}: ${ghFailed(error, `gh run download ${id}`, '--from-queue')}` };
  }
}
