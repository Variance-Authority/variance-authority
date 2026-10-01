// compass: variance-authority.retention
/**
 * Whether a walk between two commits in this clone reached the place its
 * history was cut.
 *
 * A shallow clone hides the parents of the commits it lists in its `shallow`
 * file, and git walks the history that is left as if it were all of it: `git
 * rev-list --count A..B` stops at the cut, counts what it saw and exits 0. On a
 * CI clone fetched a few commits deep, a record one or two weeks back on the
 * mainline is counted hundreds of commits short, and nothing in git's answer
 * says so.
 *
 * Grafts only hide parents, so a walk from `tip` that stops at `over`'s own
 * history and never reaches a cut commit saw every commit between them; one
 * that reaches the cut may have stopped short. That is the one test here, and
 * every answer a walk gives, a count or git's "no" to descent, is held to it.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** How git answered one question: its exit code, what it printed, and the first line it wrote to stderr. */
export interface Answer {
  readonly code: number;
  readonly out: string;
  readonly said: string;
}

/**
 * Ask git one question in `root`. A partial clone would otherwise fetch a
 * commit it does not hold from its promisor to answer, which is a network
 * call nobody asked for; without it, git says it cannot. Nothing here prompts
 * for a credential.
 */
export function ask(root: string, args: readonly string[]): Promise<Answer> {
  const env = { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' };
  return new Promise((done) => {
    execFile('git', args, { cwd: root, env, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1;
      done({ code, out: String(stdout).trim(), said: String(stderr).trim().split('\n')[0] ?? '' });
    });
  });
}

/**
 * The commits a shallow clone's history was cut at, none when it is not
 * shallow, or why that cannot be said. Only a missing `shallow` file means the
 * clone is whole; a file that cannot be found or read may hide a cut.
 */
async function cut(root: string): Promise<Set<string> | string> {
  const at = await ask(root, ['rev-parse', '--git-path', 'shallow']);
  if (at.code !== 0) return `git said: ${at.said}`;
  try {
    const text = await readFile(resolve(root, at.out), 'utf8');
    return new Set(text.split('\n').filter((line) => line !== ''));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    return `its shallow list could not be read: ${(error as Error).message}`;
  }
}

/**
 * The commits reachable from `tip` and not from `over` in a clone cut at
 * `shallow`, or why they are not all of them.
 */
async function walk(root: string, shallow: ReadonlySet<string>, tip: string, over: string): Promise<readonly string[] | string> {
  const walked = await ask(root, ['rev-list', tip, `^${over}`, '--']);
  if (walked.code !== 0) return `git said: ${walked.said}`;
  const commits = walked.out.split('\n').filter((commit) => commit !== '');
  return commits.some((commit) => shallow.has(commit))
    ? 'this clone is shallow, and its history between them stops at the cut'
    : commits;
}

/**
 * Why git's "no" to `over` being an ancestor of `tip` cannot be trusted, or
 * `undefined` when it can. Asked only after a "no", so a clone that is not
 * shallow pays one call.
 */
export async function cutShort(root: string, tip: string, over: string): Promise<string | undefined> {
  const shallow = await cut(root);
  if (typeof shallow === 'string') return shallow;
  if (shallow.size === 0) return undefined;
  const walked = await walk(root, shallow, tip, over);
  return typeof walked === 'string' ? walked : undefined;
}

/**
 * How many commits `tip` holds that `over` does not, as `git rev-list --count
 * over..tip` would say, or `undefined` when this clone cannot count them: a
 * revision it does not hold, or a walk between them that reached its cut. A
 * clone that is not shallow is asked for the count alone; a shallow one lists
 * the walk, and its length is the count.
 */
export async function countPast(root: string, over: string, tip: string): Promise<number | undefined> {
  const shallow = await cut(root);
  if (typeof shallow === 'string') return undefined;
  if (shallow.size === 0) {
    const counted = await ask(root, ['rev-list', '--count', tip, `^${over}`, '--']);
    return counted.code === 0 && counted.out !== '' ? Number(counted.out) : undefined;
  }
  const walked = await walk(root, shallow, tip, over);
  return typeof walked === 'string' ? undefined : walked.length;
}
