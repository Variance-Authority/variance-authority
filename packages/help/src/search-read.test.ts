import { execFileSync } from 'node:child_process';
import { access, cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tree } from '@variance-authority/mcp/tools';
import { ask, askSearch } from './ask.js';
import { readWorkspace, readWorkspaceForAnswer, workspaceSnapshotPath } from './read.js';
import { readSearchForAnswer } from './search-read.js';
import { workspaceSearchPath } from './snapshot.js';

/**
 * `search` answers from the file published beside the value, and answers what
 * the value answers.
 *
 * The published value is removed before the search is opened, so a reading that
 * fell back on it would fail rather than pass slowly.
 */

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace');

let temporary: string;
let root: string;
let at: string;
const QUESTIONS: readonly (readonly string[])[] = [
  ['--query', 'measure'],
  ['--query', 'meesure'],
  ['--query', 'numbers order'],
  ['--query', 'measure', '--from', 'packages/beta/src/again.ts'],
  ['--query', 'measure', '--to', 'packages/alpha/src/values.ts'],
  ['--query', 'nothing-is-called-this'],
];

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'help-search-'));
  root = join(temporary, 'workspace');
  await cp(WORKSPACE, root, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'],
    { cwd: root },
  );
  at = join(root, '.index');
  await readWorkspace(root, { index: at });
});

afterAll(async () => {
  await rm(temporary, { recursive: true, force: true });
});

describe('search from its published file', () => {
  it('prints what the whole value prints, footer included', async () => {
    let tree: Tree | undefined;
    const help = await readWorkspaceForAnswer(root, { index: at, justAnswer: true, tree: (drawn) => { tree = drawn; } });
    const expected = QUESTIONS.map((args) => ask(help, 'search', args, () => tree));

    await rm(workspaceSnapshotPath(at));
    let searchTree: Tree | undefined;
    const search = await readSearchForAnswer(root, { index: at, justAnswer: true, tree: (drawn) => { searchTree = drawn; } });

    expect([...(tree?.files ?? [])].length).toBeGreaterThan(0);
    expect([...(searchTree?.files ?? [])]).toEqual([...(tree?.files ?? [])]);
    expect(QUESTIONS.map((args) => askSearch(search, args, () => searchTree))).toEqual(expected);
    expect(expected[0]).toContain('Source snapshot generated ');
  });

  it('publishes the file when only the value was published', async () => {
    const other = join(root, '.upgraded');
    await readWorkspace(root, { index: other });
    await rm(workspaceSearchPath(other));

    const search = await readSearchForAnswer(root, { index: other });

    await expect(access(workspaceSearchPath(other))).resolves.toBeUndefined();
    const help = await readWorkspaceForAnswer(root, { index: other, justAnswer: true });
    expect(askSearch(search, ['--query', 'measure'])).toEqual(ask(help, 'search', ['--query', 'measure']));
  });

  it('opens a published search at any age, and scans nothing', async () => {
    const written = async (): Promise<readonly number[]> =>
      Promise.all([at, workspaceSearchPath(at)].map(async (file) => (await stat(file)).mtimeMs));
    const before = await written();

    const search = await readSearchForAnswer(root, { index: at, refreshAfterMs: 0 });

    expect(await written()).toEqual(before);
    expect(askSearch(search, ['--query', 'measure'])).toContain('measure');
  });

  it('refuses when nothing is published, and publishes nothing', async () => {
    const empty = join(root, '.unpublished');
    await expect(readSearchForAnswer(root, { index: empty })).rejects.toThrow(/none is published/);
    await expect(access(empty)).rejects.toThrow();
    await expect(access(workspaceSnapshotPath(empty))).rejects.toThrow();
  });
});
