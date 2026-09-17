import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { nameModules, readModuleNames, type ModuleNames } from '../module-names.js';
import { withIndexLock } from './index-lock.js';
import { cacheLayers, layeredFiles } from './cache-layers.js';
import { openModuleNames, recordStore, recordStores } from './instrumented-modules.js';
import {
  readTestCoverage,
  readableTestCoverage,
  seedTestCoverage,
  testCoverageFile,
  writeTestCoverage,
  type TestCoverage,
} from './index.js';

/**
 * {@link nameModules} under the exclusion it requires.
 *
 * Every test here grows the table, and growing it is what the lock covers — so
 * the fixture takes one rather than each test remembering to, which is the same
 * reason the production folds hand one another a token instead of a convention.
 */
async function number(names: string, paths: Iterable<string>): Promise<ModuleNames> {
  const held = await withIndexLock(resolve(dirname(names), 'coverage.bin'), (lock) =>
    nameModules(names, paths, lock),
  );
  if (!held.held) throw new Error(`the index beside ${names} was already held`);
  return held.value;
}

async function checkout(): Promise<string> {
  const at = await mkdtemp(resolve(tmpdir(), 'va-layers-'));
  await mkdir(resolve(at, 'primary', '.git', 'worktrees', 'feature'), { recursive: true });

  return at;
}

async function worktree(at: string, gitdir: string): Promise<string> {
  const path = resolve(at, 'feature');
  await mkdir(path, { recursive: true });
  await writeFile(resolve(path, '.git'), `gitdir: ${gitdir}\n`);

  return path;
}

describe('where a checkout keeps its cache', () => {
  test('the primary checkout reads and writes one directory', async () => {
    const at = await checkout();
    const layers = cacheLayers(resolve(at, 'primary'), '/cache');

    expect(layers.top).toBe(layers.base);
    expect(layeredFiles(layers, 'coverage.bin')).toEqual([resolve(layers.base, 'coverage.bin')]);
  });

  test('a worktree writes its own directory beneath the base it shares', async () => {
    const at = await checkout();
    const path = await worktree(at, resolve(at, 'primary', '.git', 'worktrees', 'feature'));
    const layers = cacheLayers(path, '/cache');
    const primary = cacheLayers(resolve(at, 'primary'), '/cache');

    expect(layers.base).toBe(primary.base);
    expect(layers.top).toBe(resolve(primary.base, '.work', layers.top.split('/').pop()!));
    expect(layers.top.startsWith(resolve(primary.base, '.work'))).toBe(true);
  });

  test('a worktree reads its own layer first and the repository second', async () => {
    const at = await checkout();
    const layers = cacheLayers(
      await worktree(at, resolve(at, 'primary', '.git', 'worktrees', 'feature')),
      '/cache',
    );

    expect(layeredFiles(layers, 'names.bin')).toEqual([
      resolve(layers.top, 'names.bin'),
      resolve(layers.base, 'names.bin'),
    ]);
  });

  test('a gitdir written relative to the worktree names the same primary checkout', async () => {
    const at = await checkout();
    const absolute = cacheLayers(
      await worktree(at, resolve(at, 'primary', '.git', 'worktrees', 'feature')),
      '/cache',
    );
    const relative = cacheLayers(
      await worktree(at, '../primary/.git/worktrees/feature'),
      '/cache',
    );

    expect(relative.base).toBe(absolute.base);
  });

  test('a directory that is no checkout is its own base', async () => {
    const at = await mkdtemp(resolve(tmpdir(), 'va-layers-'));
    const layers = cacheLayers(at, '/cache');

    expect(layers.top).toBe(layers.base);
  });

  test('a checkout that is not a worktree is its own base, `.git` directory and all', async () => {
    const at = await checkout();
    const layers = cacheLayers(resolve(at, 'primary'), '/cache');
    const elsewhere = cacheLayers(at, '/cache');

    expect(layers.top).toBe(layers.base);
    expect(layers.base).not.toBe(elsewhere.base);
  });
});

describe('what a checkout inherits', () => {
  test('a worktree takes over the numbering rather than restarting it', async () => {
    const at = await checkout();
    const cacheRoot = resolve(at, 'cache');
    const primary = resolve(at, 'primary');
    const base = await number(openModuleNames(primary, cacheRoot), ['a.ts', 'b.ts', 'c.ts']);

    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));
    const grown = await number(openModuleNames(path, cacheRoot), ['d.ts']);

    // Every id the base assigned still means the path it meant, and the new one
    // continues the count instead of repeating an id that is already spoken for.
    expect(grown.idOf('a.ts')).toBe(base.idOf('a.ts'));
    expect(grown.idOf('c.ts')).toBe(base.idOf('c.ts'));
    expect(grown.idOf('d.ts')).toBe(base.count);
  });

  test('the primary checkout does not see what a worktree numbered', async () => {
    const at = await checkout();
    const cacheRoot = resolve(at, 'cache');
    const primary = resolve(at, 'primary');
    await number(openModuleNames(primary, cacheRoot), ['a.ts']);
    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));
    await number(openModuleNames(path, cacheRoot), ['branch-only.ts']);

    expect(readModuleNames(openModuleNames(primary, cacheRoot)).idOf('branch-only.ts')).toBeUndefined();
  });

  test('a worktree reads the record store beneath its own, nearest last', async () => {
    const at = await checkout();
    const cacheRoot = resolve(at, 'cache');
    const primary = resolve(at, 'primary');
    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));

    expect(recordStores(primary, 'build', cacheRoot)).toEqual([recordStore(primary, 'build', cacheRoot)]);
    expect(recordStores(path, 'build', cacheRoot)).toEqual([
      recordStore(primary, 'build', cacheRoot),
      recordStore(path, 'build', cacheRoot),
    ]);
  });

  test('seeding is once: a checkout that has its own keeps it', async () => {
    const at = await checkout();
    const cacheRoot = resolve(at, 'cache');
    const primary = resolve(at, 'primary');
    await number(openModuleNames(primary, cacheRoot), ['a.ts']);
    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));
    await number(openModuleNames(path, cacheRoot), ['b.ts']);
    // The base grows after the worktree already took a copy.
    await number(openModuleNames(primary, cacheRoot), ['later.ts']);

    const held = readModuleNames(openModuleNames(path, cacheRoot));
    expect(held.idOf('b.ts')).toBeDefined();
    expect(held.idOf('later.ts')).toBeUndefined();
  });
});

describe('the snapshot a checkout starts from', () => {
  const snapshot: TestCoverage = {
    version: 3,
    instrumentation: 'probe-recipe',
    tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }],
    modules: [],
  };

  test('a worktree starts from the repository snapshot and writes its own', async () => {
    const at = await checkout();
    const cacheRoot = resolve(at, 'cache');
    const primary = resolve(at, 'primary');
    await writeTestCoverage(testCoverageFile(primary, cacheRoot), snapshot);

    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));
    const file = testCoverageFile(path, cacheRoot);
    await seedTestCoverage(file, path, cacheRoot);

    expect((await readTestCoverage(file)).tests).toEqual(snapshot.tests);
    expect(file).not.toBe(testCoverageFile(primary, cacheRoot));
  });

  test('a reader takes the repository snapshot without making a copy of it', async () => {
    const at = await checkout();
    const cacheRoot = resolve(at, 'cache');
    const primary = resolve(at, 'primary');
    await writeTestCoverage(testCoverageFile(primary, cacheRoot), snapshot);
    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));

    expect(await readableTestCoverage(path, cacheRoot)).toBe(testCoverageFile(primary, cacheRoot));
    await expect(stat(testCoverageFile(path, cacheRoot))).rejects.toThrow();
  });

  test('a base this build cannot read leaves the worktree with nothing, not an error', async () => {
    const at = await checkout();
    const cacheRoot = resolve(at, 'cache');
    const primary = resolve(at, 'primary');
    const base = testCoverageFile(primary, cacheRoot);
    await mkdir(dirname(base), { recursive: true });
    await writeFile(base, Buffer.from('not a snapshot this build knows'));

    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));
    const file = testCoverageFile(path, cacheRoot);
    await expect(seedTestCoverage(file, path, cacheRoot)).resolves.toBeUndefined();
    await expect(stat(file)).rejects.toThrow();
  });

  test('a caller that named its own file is not seeded into', async () => {
    const at = await checkout();
    const cacheRoot = resolve(at, 'cache');
    const primary = resolve(at, 'primary');
    await writeTestCoverage(testCoverageFile(primary, cacheRoot), snapshot);
    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));
    const mine = resolve(path, 'mine.bin');

    await seedTestCoverage(mine, path, cacheRoot);
    await expect(stat(mine)).rejects.toThrow();
    await expect(stat(testCoverageFile(path, cacheRoot))).rejects.toThrow();
  });
});
