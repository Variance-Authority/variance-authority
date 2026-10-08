import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reviewedCommit } from './review-head.js';

const git = (at: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: at, stdio: 'pipe', encoding: 'utf8' }).trim();

describe('the commit a review read', () => {
  it('calls the tree dirty when it holds a file git does not track, which the review reads as part of the change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-review-head-'));
    git(root, ['init', '--quiet', '--initial-branch', 'main']);
    git(root, ['-c', 'user.email=f@example.test', '-c', 'user.name=F', 'commit', '--quiet', '--allow-empty', '-m', 'start']);
    const commit = git(root, ['rev-parse', 'HEAD']);

    expect(await reviewedCommit(root, root, {})).toEqual({ commit, parents: [] });

    await writeFile(join(root, 'created.ts'), 'export const created = 1;\n');
    expect(await reviewedCommit(root, root, {})).toEqual({ commit, parents: [], dirty: true });
  });
});
