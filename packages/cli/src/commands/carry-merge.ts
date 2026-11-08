/**
 * A pull request's head, merged with the commit the mainline's record was made
 * at.
 *
 * The host checks a pull request out as its head merged into the base tip, and
 * the record was made at an older commit. A selection that compares the
 * checkout with the record then measures what the base gained since too. `merge`
 * stands the checkout on the head merged into the record's commit instead, so
 * the comparison holds the pull request's change alone.
 *
 * Every job of a run makes the same commit: the parents, the identity, the date
 * and the message are fixed, so the job that decided the run hands its merge to
 * the others as `--expect`, and one whose clone merged differently stops. A head
 * that conflicts with the record's commit stays on the host's merge under
 * `--on-conflict stay`, and fails the job under `fail`. A merge stopped by
 * anything but a conflict always fails, naming git's reason, and every stop
 * leaves the checkout where it started.
 */

// compass: variance-authority.retention

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ParsedCarry } from '../carry-args.js';
import { OperatorError, type ExitCode } from '../exit.js';
import { pullRequestHead } from '../share-lines.js';
import { printMoved } from './carry-pushed.js';
import { gitSaid } from './reach-command.js';

const run = promisify(execFile);

/** Whose merge it is, the same in every clone. */
const IDENTITY = { name: 'variance-authority', email: 'variance-authority@users.noreply.github.com' };

type Streams = { readonly out: (text: string) => void; readonly err: (text: string) => void };

/** `variance carry merge <commit>`: stand the checkout on the head merged into `commit`. */
export async function mergeHead(parsed: ParsedCarry, root: string, streams: Streams, env: NodeJS.ProcessEnv): Promise<ExitCode> {
  const say = (text: string): string => (parsed.format === 'github' ? `::notice::${text}` : text);
  if (parsed.commit === undefined || parsed.commit === '') {
    return printMoved(parsed.format, ['merged=false'], [say('carry merge: the mainline has no record, so the checkout stays as it is')], streams);
  }
  const asked = parsed.head ?? (await pullRequestHead(env));
  if (asked === undefined) throw new OperatorError('`carry merge` needs the head: `--head <sha>`, or a pull request event that names it');

  const git = gitIn(root, env);
  const commit = await commitOf(git, parsed.commit);
  const head = await commitOf(git, asked);
  // A stop resets the checkout hard, which would take an uncommitted change with it.
  const dirty = (await git(['diff', 'HEAD', '--name-only'])).stdout.trim().split('\n').filter(Boolean);
  if (dirty.length > 0) {
    throw new OperatorError(
      `\`carry merge\` stands the checkout on another commit, and ${dirty.join(', ')} ${dirty.length === 1 ? 'holds' : 'hold'} changes nobody committed: commit or stash them first`,
    );
  }
  const started = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const date = `@${Math.max(await committedAt(git, commit), await committedAt(git, head))} +0000`;

  await git(['checkout', '-q', '--detach', commit]);
  try {
    // The environment, not `-c user.*`: a variable the job set would win over the config.
    await git(['-c', 'commit.gpgsign=false', 'merge', '-q', '--no-ff', '--no-edit', '-m', `Merge ${head} with the record's commit ${commit}`, head], {
      GIT_AUTHOR_NAME: IDENTITY.name,
      GIT_AUTHOR_EMAIL: IDENTITY.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: IDENTITY.name,
      GIT_COMMITTER_EMAIL: IDENTITY.email,
      GIT_COMMITTER_DATE: date,
    });
  } catch (error) {
    const conflicted = (await git(['diff', '--name-only', '--diff-filter=U'])).stdout.trim().split('\n').filter(Boolean);
    await restore(git, started);
    if (conflicted.length === 0) {
      throw new OperatorError(`\`carry merge\` stopped merging ${short(head)} with ${short(commit)} without a conflict: ${gitSaid(error)}`, { cause: error });
    }
    if (parsed.onConflict !== 'stay') {
      throw new OperatorError(`The head ${short(head)} conflicts with ${short(commit)}, the record's commit, in ${conflicted.join(', ')}`);
    }
    return printMoved(
      parsed.format,
      ['merged=false'],
      [say(`carry merge: the head ${short(head)} conflicts with ${short(commit)}, the record's commit, in ${conflicted.join(', ')}, so it stays on the host's merge, and the selection measures what the base gained since the record too`)],
      streams,
    );
  }

  const checkout = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  if (parsed.expect !== undefined && parsed.expect !== checkout) {
    await restore(git, started);
    throw new OperatorError(`The merge of ${short(head)} with ${short(commit)} is ${checkout} here, and ${parsed.expect} in the job that decided it: the two checkouts differ`);
  }
  return printMoved(parsed.format, ['merged=true', `checkout=${checkout}`], [`carry merge: ${short(head)} merged with ${short(commit)}, the record's commit, at ${short(checkout)}`], streams);
}

type Git = (args: readonly string[], extra?: Readonly<Record<string, string>>) => Promise<{ stdout: string; stderr: string }>;

/** Git in `root`, under the caller's environment and any variables `extra` names. */
function gitIn(root: string, env: NodeJS.ProcessEnv): Git {
  return (args, extra = {}) => run('git', [...args], { cwd: root, env: { ...process.env, ...env, ...extra } });
}

/** The full sha `name` resolves to here, or a refusal that names it. */
async function commitOf(git: Git, name: string): Promise<string> {
  try {
    return (await git(['rev-parse', '--verify', '--quiet', `${name}^{commit}`])).stdout.trim();
  } catch (error) {
    throw new OperatorError(`\`carry merge\` cannot find the commit ${name} in this clone: fetch it, or the history that holds it`, { cause: error });
  }
}

async function committedAt(git: Git, commit: string): Promise<number> {
  return Number((await git(['log', '-1', '--format=%ct', commit])).stdout.trim());
}

/** Abort what the merge left and stand where the job started. */
async function restore(git: Git, started: string): Promise<void> {
  await git(['merge', '--abort']).catch(() => git(['reset', '-q', '--hard']));
  await git(['checkout', '-q', '--detach', started]);
}

function short(sha: string): string {
  return sha.slice(0, 12);
}
