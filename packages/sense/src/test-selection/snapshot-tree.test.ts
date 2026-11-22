import { execFileSync } from 'node:child_process';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { snapshotTree, workingTree } from './own-layer.js';

/**
 * The tree of the working state is written through a copy of the index, so
 * the real one is left as it was. Git trusts an entry whose stat matches the
 * file unless the entry is as new as the index file: then the file may have
 * changed within the same tick, and git reads its content.
 */
describe('the tree of the working state', () => {
  it('holds an edit of the same size made in the second the file was staged', () => {
    const root = mkdtempSync(join(tmpdir(), 'va-snapshot-tree-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '--quiet');
    git('config', 'user.email', 'fixture@example.test');
    git('config', 'user.name', 'Fixture');
    // One fixed second for the file, its index entry and the index itself:
    // the edit lands in the tick the file was staged, as a fast edit after a
    // commit does, and nothing but the content tells the two texts apart.
    const tick = new Date('2020-01-01T00:00:00Z');
    const file = join(root, 'setup.ts');
    writeFileSync(file, 'export const ready = 1;\n');
    utimesSync(file, tick, tick);
    git('add', '-A');
    git('commit', '--quiet', '-m', 'one');
    utimesSync(join(root, '.git', 'index'), tick, tick);
    writeFileSync(file, 'export const ready = 2;\n');
    utimesSync(file, tick, tick);
    git('config', 'core.checkStat', 'minimal');
    git('config', 'core.trustctime', 'false');

    const tree = snapshotTree(root);

    expect(tree).toBeDefined();
    expect(tree).not.toBe(git('rev-parse', 'HEAD^{tree}'));
    expect(git('show', `${tree}:setup.ts`)).toBe('export const ready = 2;');
  });

  it('is absent in a directory git does not hold', () => {
    expect(workingTree(mkdtempSync(join(tmpdir(), 'va-working-tree-')))).toBeUndefined();
  });

  it('is absent in a repository before its first commit, which has no tree to differ from', () => {
    const root = mkdtempSync(join(tmpdir(), 'va-working-tree-'));
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    writeFileSync(join(root, 'setup.ts'), 'export const ready = 1;\n');

    expect(workingTree(root)).toBeUndefined();
  });
});
