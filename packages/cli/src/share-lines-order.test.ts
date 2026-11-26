// compass: variance-authority.reach.crossings
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keptInOrder } from './share-lines.js';

/**
 * The kept commits in the order git's first-parent history of the mainline
 * puts them, as the clone last fetched it: what History measures a move by.
 */

function clone(): { readonly root: string; readonly commit: (message: string) => string; readonly git: (...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), 'va-kept-order-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  const commit = (message: string, at?: number) => {
    const env = at === undefined ? process.env : { ...process.env, GIT_COMMITTER_DATE: `@${Math.round(at / 1000)} +0000`, GIT_AUTHOR_DATE: `@${Math.round(at / 1000)} +0000` };
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', message], { cwd: root, env });
    return git('rev-parse', 'HEAD');
  };
  return { root, commit, git };
}

describe('the kept commits, in the mainline\'s order', () => {
  it('gives the kept commits on the fetched mainline\'s first-parent history, oldest first, and leaves out one it does not reach', async () => {
    const { root, commit, git } = clone();
    const first = commit('one');
    git('checkout', '-q', '-b', 'side');
    const side = commit('side');
    git('checkout', '-q', 'main');
    const second = commit('two');
    git('merge', '-q', '--no-ff', '-m', 'merge', 'side');
    const merge = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', merge);
    const unfetched = commit('three');

    expect(await keptInOrder({}, 'main', new Set([merge, unfetched, side, first, second]), 0, root)).toEqual([first, second, merge]);
  });

  it('walks no further back than a day before the window opens, so a kept commit that landed earlier is not placed', async () => {
    const { root, commit, git } = clone();
    const DAY = 86_400_000;
    const opens = Date.UTC(2026, 10, 20);
    const long = commit('long before', opens - 3 * DAY);
    const eve = commit('the eve', opens - DAY / 2);
    const inside = commit('inside', opens + DAY);
    git('update-ref', 'refs/remotes/origin/main', inside);

    expect(await keptInOrder({}, 'main', new Set([long, eve, inside]), opens, root)).toEqual([eve, inside]);
  });

  it('gives nothing where the clone has not fetched the mainline', async () => {
    const { root, commit } = clone();
    expect(await keptInOrder({}, 'main', new Set([commit('one')]), 0, root)).toEqual([]);
  });
});
