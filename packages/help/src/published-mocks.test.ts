import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Tree } from '@variance-authority/mcp/tools';
import { updateSourceIndex } from '@variance-authority/sense';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as read from './read.js';
import { readWorkspaceSnapshot } from './snapshot.js';
import { publishWorkspaceFromIndex } from './refresh-native.js';

/**
 * The tree `variance index` publishes carries the module a test loads for real.
 *
 * `vi.importActual('./real')` reaches `real.ts` as surely as an import, and
 * the walk a question takes from a start point reads only the published tree.
 * So it is resolved when the tree is published, by the resolver that resolves
 * imports, and a relative one that lands nowhere marks the test as unknown,
 * the way the question-time graph does.
 */

vi.mock('./read.js', async (original) => {
  const actual = await original<typeof import('./read.js')>();
  return { ...actual, readWorkspaceOver: vi.fn(actual.readWorkspaceOver) };
});

const temporary: string[] = [];
let root: string;
let index: string;

function write(file: string, contents: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

const TEST = 'packages/a/src/see.test.ts';
const MOCKED = 'packages/a/src/real.ts';

/** A test that loads the real module beside a mock, and one that names a module that is not there. */
const MOCKS = "import { vi } from 'vitest';\nconst real = await vi.importActual('./real');\nconst gone = await vi.importActual('./gone');\n";

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'help-published-mocks-')));
  temporary.push(root);
  write('package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['packages/a'] }));
  write('packages/a/package.json', JSON.stringify({ name: 'a', exports: { '.': './src/index.ts' } }));
  write('packages/a/src/index.ts', 'export const see = 1;\n');
  write('packages/a/src/api.ts', 'export const fetchThing = () => 0;\n');
  write(MOCKED, 'export const fetchThing = () => 1;\n');
  write(TEST, MOCKS);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });
  const cache = mkdtempSync(join(tmpdir(), 'help-published-mocks-cache-'));
  temporary.push(cache);
  index = join(cache, 'source-index.bin');
  await updateSourceIndex(root, { index });
});

afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

async function publishedTree(): Promise<Tree> {
  let tree: Tree | undefined;
  await readWorkspaceSnapshot(root, { index, tree: (drawn) => { tree = drawn; } });
  if (tree === undefined) throw new Error('no tree was published');
  return tree;
}

describe('the published tree', () => {
  it('reaches the module a test loads for real when the workspace is read', async () => {
    await publishWorkspaceFromIndex(root, { index, readStartedAt: '2026-11-14T00:00:00.000Z' });

    const tree = await publishedTree();

    expect([...tree.reachedFrom([TEST])]).toContain(MOCKED);
    expect(tree.unknownAmong([TEST])).toEqual([TEST]);
  });

  it('reaches the module a test loads for real when the index refreshes it', async () => {
    await publishWorkspaceFromIndex(root, { index, readStartedAt: '2026-11-14T00:00:00.000Z' });
    write(TEST, `// moved\n${MOCKS}`);
    await updateSourceIndex(root, { index });
    vi.mocked(read.readWorkspaceOver).mockClear();

    await publishWorkspaceFromIndex(root, { index, readStartedAt: '2026-11-14T00:00:00.000Z' });
    const tree = await publishedTree();

    expect(read.readWorkspaceOver).not.toHaveBeenCalled();
    expect([...tree.reachedFrom([TEST])]).toContain(MOCKED);
    expect(tree.unknownAmong([TEST])).toEqual([TEST]);
  });

  it('reaches the module a test loads for real when a caller\'s taints keep the tree on the JavaScript side', async () => {
    await publishWorkspaceFromIndex(root, { index, readStartedAt: '2026-11-14T00:00:00.000Z' });
    await read.readWorkspaceForAnswer(root, { index, taints: [] });
    const tree = await publishedTree();

    expect([...tree.reachedFrom([TEST])]).toContain(MOCKED);
    expect(tree.unknownAmong([TEST])).toEqual([TEST]);
  });
});
