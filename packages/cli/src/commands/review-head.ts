// compass: variance-authority/runtime/attention
/**
 * The commit a review read, as git names it.
 *
 * On a pull request CI checks out the merge GitHub made of it, and that merge
 * is a commit nobody pushed: a reader holding the pull request knows its head,
 * not the merge. So a review names the checkout's commit and its parents, and
 * whether the tree had edits on top of it. A link into the code is made only at
 * a commit the tree is, on the host `origin` names.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Review } from './review.js';

const run = promisify(execFile);

/** `HEAD` in `repository`, or absent when git cannot say. `here` is the directory the review's file names are relative to. */
export async function headOf(repository: string, here = process.cwd()): Promise<Review['head'] | undefined> {
  try {
    const { stdout } = await run('git', ['rev-list', '--parents', '-n1', 'HEAD'], { cwd: repository });
    const [commit, ...parents] = stdout.trim().split(/\s+/u);
    if (commit === undefined || commit === '') return undefined;
    const dirty = await run('git', ['diff', '--quiet', 'HEAD'], { cwd: repository }).then(() => false, () => true);
    if (dirty) return { commit, parents, dirty: true };
    const blob = await blobOf(commit, here);
    return { commit, parents, ...(blob === undefined ? {} : { blob }) };
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
