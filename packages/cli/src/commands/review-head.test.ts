import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reviewedCommit } from './review-head.js';
import { formatReview } from './review-text.js';

const git = (at: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: at, stdio: 'pipe', encoding: 'utf8' }).trim();

describe('the commit a review read', () => {
  const started = process.cwd();
  afterEach(() => process.chdir(started));

  async function repository(): Promise<{ root: string; commit: string }> {
    const root = await mkdtemp(join(tmpdir(), 'variance-review-head-'));
    git(root, ['init', '--quiet', '--initial-branch', 'main']);
    git(root, ['-c', 'user.email=f@example.test', '-c', 'user.name=F', 'commit', '--quiet', '--allow-empty', '-m', 'start']);
    return { root, commit: git(root, ['rev-parse', 'HEAD']) };
  }

  it('reads no CI run of its own under test, so a review a test makes reads the same commit on a push as on a pull request', async () => {
    const { root, commit } = await repository();
    process.chdir(root);

    expect(Object.keys(process.env).filter((name) => name.startsWith('GITHUB_'))).toEqual([]);
    expect(await reviewedCommit(root)).toEqual({ commit, parents: [] });
  });

  it('calls the tree dirty when it holds a file git does not track, which the review reads as part of the change', async () => {
    const { root, commit } = await repository();
    process.chdir(root);

    expect(await reviewedCommit(root, {})).toEqual({ commit, parents: [] });

    await writeFile(join(root, 'created.ts'), 'export const created = 1;\n');
    expect(await reviewedCommit(root, {})).toEqual({ commit, parents: [], dirty: true });
  });

  it('links from the directory the diff names files from, whatever `--root` names', async () => {
    // The diff names `app/src/total.ts` from the top, so a link made at `app/` would read `app/app/src/total.ts`.
    const { root, commit } = await repository();
    git(root, ['remote', 'add', 'origin', 'git@github.com:o/r.git']);
    await mkdir(join(root, 'app'));

    process.chdir(root);
    expect((await reviewedCommit(root, {}))?.blob).toBe(`https://github.com/o/r/blob/${commit}`);
    process.chdir(join(root, 'app'));
    expect((await reviewedCommit(root, {}))?.blob).toBe(`https://github.com/o/r/blob/${commit}/app`);
  });

  it('names a pull request head only on a pull request event, even when the event file names one', async () => {
    const { root, commit } = await repository();
    process.chdir(root);
    const head = 'h'.repeat(40);
    const event = join(root, '..', `${basename(root)}-event.json`);
    await writeFile(event, JSON.stringify({ pull_request: { head: { sha: head } } }));
    const on = (name: string) => reviewedCommit(root, { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: event });

    // A push or a merge queue checks out the commit it runs for: there is no merge, and no other head to name.
    expect(await on('push')).toEqual({ commit, parents: [] });
    expect(await on('merge_group')).toEqual({ commit, parents: [] });
    expect(await on('pull_request')).toEqual({ commit, parents: [], pull: head });
    expect(await on('pull_request_target')).toEqual({ commit, parents: [], pull: head });
  });

  it('names the pull request and its merge when CI left the checkout dirty', () => {
    const [base, head, merge] = ['b', 'h', 'm'].map((letter) => letter.repeat(40));
    const markdown = formatReview({
      from: base!, base: 'since', files: [], head: { commit: merge!, parents: [base!, head!], pull: head!, dirty: true },
    }, 'markdown');

    expect(markdown).toContain(`Reviewed the working tree over \`${merge!.slice(0, 12)}\`, the merge of \`${head!.slice(0, 12)}\` into \`${base!.slice(0, 12)}\` for this run.`);
    expect(markdown).toContain(`If the pull request's head is no longer \`${head!.slice(0, 12)}\`, this review describes an earlier commit.`);
  });
});
