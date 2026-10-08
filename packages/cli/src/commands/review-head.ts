// compass: variance-authority/runtime/attention
/**
 * The commit a review read, as git names it.
 *
 * On a pull request CI checks out the merge GitHub made of it, and that merge
 * is a commit nobody pushed: a reader holding the pull request knows its head,
 * not the merge. So a review names the checkout's commit and its parents, the
 * pull request's head when the CI event names one, and whether the tree had
 * edits or new files on top of it. A link into the code is made only at a
 * commit the tree is, on the host `origin` names.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { workingTreeChanges } from '@variance-authority/sense';
import { pullRequestHead, type Env } from '../share-lines.js';
import type { Review } from './review.js';

const run = promisify(execFile);

/**
 * `HEAD` in `repository`, or absent when git cannot say. A link starts at the
 * working directory, where `diffSince` names the review's files from, not at
 * `--root`.
 *
 * The tree is dirty when `workingTreeChanges` names any path: an edit, or a
 * file git does not ignore and does not track. The review reads those as part
 * of the change. When git cannot say, the commit is named with no link, and
 * no claim either way.
 */
export async function reviewedCommit(repository: string, env: Env = process.env): Promise<Review['head'] | undefined> {
  try {
    const { stdout } = await run('git', ['rev-list', '--parents', '-n1', 'HEAD'], { cwd: repository });
    const [commit, ...parents] = stdout.trim().split(/\s+/u);
    if (commit === undefined || commit === '') return undefined;
    const pull = await pullRequestHead(env);
    const named = { commit, parents, ...(pull === undefined ? {} : { pull }) };
    const changes = await workingTreeChanges(repository, '');
    if (changes === undefined) return named;
    if (changes.changed.length > 0 || changes.gone.length > 0) return { ...named, dirty: true };
    const blob = await blobOf(commit, process.cwd());
    return { ...named, ...(blob === undefined ? {} : { blob }) };
  } catch {
    return undefined;
  }
}

/** Where GitHub shows the files of `commit`, at the directory the file names start from. */
async function blobOf(commit: string, here: string): Promise<string | undefined> {
  const url = await run('git', ['remote', 'get-url', 'origin'], { cwd: here }).then(({ stdout }) => stdout.trim(), () => undefined);
  const repository = url === undefined ? undefined : githubRepository(url);
  if (repository === undefined) return undefined;
  const { stdout } = await run('git', ['rev-parse', '--show-prefix'], { cwd: here });
  const prefix = stdout.trim().replace(/\/$/u, '');
  return `https://github.com/${repository}/blob/${commit}${prefix === '' ? '' : `/${prefix}`}`;
}

/** `owner/name` of a GitHub remote, in its HTTPS or SSH form. */
function githubRepository(url: string): string | undefined {
  const match = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/u.exec(url);
  return match?.[1];
}
