// compass: variance-authority/runtime/attention
/**
 * Where the change the runs ran for starts, when git agrees it is a start.
 *
 * The runs record's `over` is a plain fact, written without asking anyone: the
 * commit of the snapshot the first run at this commit was laid over. It is not
 * always where this commit's change starts. Main's shards landed over a
 * branch's snapshot, or a suite run again after checking out an older commit,
 * are laid over a commit their own does not descend from, and a review that
 * diffed from it would read the branch's own later commits as the change and
 * say nothing.
 *
 * Whether one commit descends from another is git's to answer, and it can only
 * be asked where the review runs: the writer may be a landing run outside the
 * checkout, or in CI before the other commit was fetched. So it is asked here,
 * at read time, and git's three answers are three outcomes. Yes: `over` is the
 * start. No: the runs name no start, and the review takes the path it takes
 * for runs laid over nothing. Cannot say: a commit this clone does not hold, or
 * a shallow clone whose walk between the two stopped at its cut. That is
 * refused, naming the commit to fetch, because a start guessed either way is a
 * review that silently reads the wrong change.
 *
 * The record is a file anyone can write, and its commits reach git's argument
 * list, so each is held to the shape of an object name before git sees it.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { commitRunsFile, type CommitRuns } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';

/** A full object name, SHA-1 or SHA-256: never an option, never a revision expression. */
const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** How git answered one question: its exit code, what it printed, and the first line it wrote to stderr. */
interface Answer {
  readonly code: number;
  readonly out: string;
  readonly said: string;
}

/**
 * Ask git one question in `root`. A partial clone would otherwise fetch a
 * commit it does not hold from its promisor to answer, which is a network
 * call a review never asked for; without it, git says it cannot.
 */
function ask(root: string, args: readonly string[]): Promise<Answer> {
  const env = { ...process.env, GIT_NO_LAZY_FETCH: '1' };
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
 * Why git's "no" to `over` being an ancestor of `tip` cannot be trusted, or
 * `undefined` when it can. Grafts only hide parents, so a walk from `tip` that
 * stops at `over`'s own history and never reaches a cut commit saw every
 * ancestor `over` could be; one that reaches the cut may have stopped short.
 * Asked only after a "no", so a clone that is not shallow pays one call.
 */
async function cutShort(root: string, tip: string, over: string): Promise<string | undefined> {
  const shallow = await cut(root);
  if (typeof shallow === 'string') return shallow;
  if (shallow.size === 0) return undefined;
  const walked = await ask(root, ['rev-list', tip, `^${over}`, '--']);
  if (walked.code !== 0) return `git said: ${walked.said}`;
  return walked.out.split('\n').some((commit) => shallow.has(commit))
    ? 'this clone is shallow, and its history between them stops at the cut'
    : undefined;
}

/**
 * The commit a review of `runs` starts from, or `undefined` when the runs name
 * none: no record, no `over`, or an `over` git says the runs' commit does not
 * descend from. Throws when git cannot say, and when the record is malformed.
 *
 * A record with no `commit` was written outside a checkout; the commit its
 * change reaches is then the one checked out, and `over` is asked of `HEAD`.
 * `coverageFile` is the snapshot the record sits beside, named when it is refused.
 */
export async function runsBase(root: string, runs: CommitRuns | undefined, coverageFile: string): Promise<string | undefined> {
  if (runs === undefined) return undefined;
  const { over, commit } = runs;
  const file = commitRunsFile(coverageFile);
  for (const [field, value] of [['over', over], ['commit', commit]] as const) {
    if (value !== undefined && !OBJECT_NAME.test(value)) {
      throw new OperatorError(
        `\`${file}\` is malformed: its \`${field}\` is ${JSON.stringify(value)}, which is not a commit's full object name. ` +
          'Delete it and run the suite again, or name the base with `--since <ref>`.',
      );
    }
  }
  if (over === undefined) return undefined;
  const tip = commit ?? 'HEAD';
  const answer = await ask(root, ['merge-base', '--is-ancestor', over, tip]);
  if (answer.code === 0) return over;
  const why = answer.code === 1 ? await cutShort(root, tip, over) : `git said: ${answer.said}`;
  if (why === undefined) return undefined;
  const whose = commit === undefined ? 'the checked-out commit' : commit.slice(0, 12);
  throw new OperatorError(
    `the runs ${commit === undefined ? 'name no commit and' : `at ${whose}`} were laid over ${over.slice(0, 12)}, ` +
      `and git cannot say whether ${whose} descends from it: ${why}. ` +
      `Fetch ${over} with the history between them, or name the base with \`--since <ref>\`.`,
  );
}
