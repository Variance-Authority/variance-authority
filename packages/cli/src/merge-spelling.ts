/**
 * The merge `carry merge` makes of a pull request's head and the record's
 * commit, spelled the same in every clone: its identity, its date and its
 * message. `carry merge` makes it in a checkout, and `share --from-queue`
 * makes it again with `git commit-tree` to prove which merge a run tested; one
 * spelling keeps the two hashes equal.
 */

// compass: variance-authority.retention

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Whose merge it is, the same in every clone. */
const IDENTITY = { name: 'variance-authority', email: 'variance-authority@users.noreply.github.com' };

export type Git = (args: readonly string[], extra?: Readonly<Record<string, string>>) => Promise<{ stdout: string; stderr: string }>;

/** Git in `root`, under the caller's environment and any variables `extra` names. */
export function gitIn(root: string, env: NodeJS.ProcessEnv): Git {
  return (args, extra = {}) => run('git', [...args], { cwd: root, env: { ...process.env, ...env, ...extra } });
}

/** The message, the identity and the date of the merge of `head` with `commit`: the later of their commit times. */
export async function spelling(git: Git, commit: string, head: string): Promise<{ readonly message: string; readonly env: Readonly<Record<string, string>> }> {
  const date = `@${Math.max(await committedAt(git, commit), await committedAt(git, head))} +0000`;
  // The environment, not `-c user.*`: a variable the job set would win over the config.
  const env = {
    GIT_AUTHOR_NAME: IDENTITY.name,
    GIT_AUTHOR_EMAIL: IDENTITY.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: IDENTITY.name,
    GIT_COMMITTER_EMAIL: IDENTITY.email,
    GIT_COMMITTER_DATE: date,
  };
  return { message: `Merge ${head} with the record's commit ${commit}`, env };
}

async function committedAt(git: Git, commit: string): Promise<number> {
  return Number((await git(['log', '-1', '--format=%ct', commit])).stdout.trim());
}

/** The first twelve characters of `sha`, as a line names a commit. */
export function short(sha: string): string {
  return sha.slice(0, 12);
}
