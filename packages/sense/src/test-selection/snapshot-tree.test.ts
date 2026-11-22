import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
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

    const snapshot = snapshotTree(root);

    expect(snapshot).toHaveProperty('tree');
    const { tree, env, close } = snapshot as Extract<typeof snapshot, { tree: string }>;
    expect(tree).not.toBe(git('rev-parse', 'HEAD^{tree}'));
    expect(execFileSync('git', ['show', `${tree}:setup.ts`], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' })).toBe('export const ready = 2;\n');
    close();
  });

  it('leaves no object in the repository once closed, however many files it wrote', () => {
    const root = mkdtempSync(join(tmpdir(), 'va-snapshot-tree-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '--quiet');
    git('config', 'user.email', 'fixture@example.test');
    git('config', 'user.name', 'Fixture');
    writeFileSync(join(root, 'setup.ts'), 'export const ready = 1;\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'one');
    const before = git('count-objects', '-v');
    writeFileSync(join(root, 'setup.ts'), 'export const ready = 2;\n');
    writeFileSync(join(root, 'new.ts'), 'export const fresh = 1;\n');

    const snapshot = snapshotTree(root);
    expect(snapshot).toHaveProperty('tree');
    const { tree, env, close } = snapshot as Extract<typeof snapshot, { tree: string }>;
    // Readable while open, through the environment it hands out, and the commit it reads from with it.
    expect(execFileSync('git', ['diff', '--name-only', 'HEAD', tree], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' })).toBe('new.ts\nsetup.ts\n');
    close();

    expect(git('count-objects', '-v')).toBe(before);
    expect(() => git('cat-file', '-e', tree)).toThrow();
  });

  it('keeps a blob a blobless clone fetched while a diff read the tree, once closed', () => {
    const home = mkdtempSync(join(tmpdir(), 'va-snapshot-tree-'));
    const origin = join(home, 'origin');
    const root = join(home, 'clone');
    mkdirSync(origin);
    const at = (cwd: string) => (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    const upstream = at(origin);
    upstream('init', '--quiet');
    upstream('config', 'user.email', 'fixture@example.test');
    upstream('config', 'user.name', 'Fixture');
    upstream('config', 'uploadpack.allowFilter', 'true');
    writeFileSync(join(origin, 'setup.ts'), 'export const ready = 1;\n');
    upstream('add', '-A');
    upstream('commit', '--quiet', '-m', 'one');
    const first = upstream('rev-parse', 'HEAD');
    const blob = upstream('rev-parse', 'HEAD:setup.ts');
    writeFileSync(join(origin, 'setup.ts'), 'export const ready = 2;\n');
    upstream('commit', '--quiet', '-am', 'two');
    // The clone checks out the second commit, so the first commit's text is one it has never fetched.
    execFileSync('git', ['clone', '--quiet', '--filter=blob:none', `file://${origin}`, root]);
    const git = at(root);
    const missing = () => git('rev-list', '--objects', '--missing=print', first).split('\n').includes(`?${blob}`);
    expect(missing()).toBe(true);
    writeFileSync(join(root, 'setup.ts'), 'export const ready = 3;\n');

    const snapshot = snapshotTree(root);
    expect(snapshot).toHaveProperty('tree');
    const { tree, env, close } = snapshot as Extract<typeof snapshot, { tree: string }>;
    // The diff needs the first commit's text, and fetches it.
    expect(execFileSync('git', ['diff', '-U0', first, tree], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' })).toContain('+export const ready = 3;');
    close();

    // The fetched text stays for the next reading, and the tree goes.
    expect(missing()).toBe(false);
    expect(() => git('cat-file', '-e', tree)).toThrow();
  });

  it('says what git said when it cannot write the tree, naming the path it stopped at', () => {
    const root = mkdtempSync(join(tmpdir(), 'va-snapshot-tree-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '--quiet');
    git('config', 'user.email', 'fixture@example.test');
    git('config', 'user.name', 'Fixture');
    writeFileSync(join(root, 'setup.ts'), 'export const ready = 1;\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'one');
    // An untracked folder that is a repository with no commit: `git add -A` refuses it.
    mkdirSync(join(root, 'vendor', 'empty'), { recursive: true });
    execFileSync('git', ['init', '--quiet'], { cwd: join(root, 'vendor', 'empty') });

    const snapshot = snapshotTree(root);

    expect(snapshot).toHaveProperty('unwritten');
    expect((snapshot as { unwritten: string }).unwritten).toContain("'vendor/empty/' does not have a commit checked out");
  });

  it('is absent in a directory git does not hold', () => {
    expect(workingTree(mkdtempSync(join(tmpdir(), 'va-working-tree-')))).toBeUndefined();
  });

  it('is absent in a repository before its first commit, which has no tree to differ from', () => {
    const root = mkdtempSync(join(tmpdir(), 'va-working-tree-'));
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    writeFileSync(join(root, 'setup.ts'), 'export const ready = 1;\n');
    // Staged, so there is an index to write the tree through, and a tree.
    execFileSync('git', ['add', '-A'], { cwd: root });

    const snapshot = snapshotTree(root);
    expect(snapshot).toHaveProperty('tree');
    if ('close' in snapshot) snapshot.close();
    expect(workingTree(root)).toBeUndefined();
  });
});
