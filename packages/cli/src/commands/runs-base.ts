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
 * a shallow clone, whose "no" only means the history it would need was cut. That
 * is refused, naming the commit to fetch, because a start guessed either way is
 * a review that silently reads the wrong change.
 */

import { execFile } from 'node:child_process';
import type { CommitRuns } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';

/** How git answered one question, as its exit code and the first line it wrote to stderr. */
interface Answer {
  readonly code: number;
  readonly said: string;
}

function ask(root: string, args: readonly string[]): Promise<Answer & { readonly out: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: root }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1;
      resolve({ code, out: String(stdout).trim(), said: String(stderr).trim().split('\n')[0] ?? '' });
    });
  });
}

/**
 * The commit a review of `runs` starts from, or `undefined` when the runs name
 * none: no record, no `over`, or an `over` git says `runs.commit` does not
 * descend from. Throws when git cannot say.
 *
 * A record with no `commit` was written outside a checkout, and there is no
 * second commit to ask about; its `over` is read as it stands, and the diff
 * from it asks git on its own.
 */
export async function runsBase(root: string, runs: CommitRuns | undefined): Promise<string | undefined> {
  const over = runs?.over;
  const commit = runs?.commit;
  if (over === undefined || commit === undefined || over === commit) return over;
  const answer = await ask(root, ['merge-base', '--is-ancestor', over, commit]);
  if (answer.code === 0) return over;
  const shallow = answer.code === 1 && (await ask(root, ['rev-parse', '--is-shallow-repository'])).out === 'true';
  if (answer.code === 1 && !shallow) return undefined;
  const why = shallow ? 'this clone is shallow, so its history may stop short of it' : `git said: ${answer.said}`;
  throw new OperatorError(
    `the runs at ${commit.slice(0, 12)} were laid over ${over.slice(0, 12)}, and git cannot say whether ` +
      `${commit.slice(0, 12)} descends from it: ${why}. Fetch ${over} with the history between them, ` +
      'or name the base with `--since <ref>`.',
  );
}
