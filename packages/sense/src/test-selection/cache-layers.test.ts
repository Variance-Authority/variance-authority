import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { cacheLayers, cacheRootFor, layeredFiles, repositoryLayers } from './cache-layers.js';
import { caseSectionsAt, recordOfCases, withoutCoverage } from './case-record.js';
import { commitRunsFile } from './commit-runs.js';
import { CrossingSets } from './crossing-sets.js';
import { encodeSetExecutionIndex } from './execution-set-format.js';
import { recordStore, recordStores } from './instrumented-modules.js';
import {
  mainlineReadRoot,
  readTestCoverage,
  readableTestCoverage,
  RecordWithoutCoverage,
  seedTestCoverage,
  testCoverageFile,
  writeFetchedMainline,
  writeTestCoverage,
  type TestCoverage,
} from './index.js';

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

describe('where the repository says the cache is', () => {
  async function repository(config?: unknown): Promise<string> {
    const at = await mkdtemp(resolve(tmpdir(), 'va-cache-root-'));
    execFileSync('git', ['init', '--quiet', at]);
    if (config !== undefined) await writeFile(resolve(at, 'variance.config.json'), JSON.stringify(config));

    return at;
  }

  test('`cacheRoot` at the repository root answers for every directory in it, over VARIANCE_AUTHORITY_CACHE', async () => {
    const at = await repository({ project: 'p', cacheRoot: '.variance/cache' });
    const member = resolve(at, 'packages', 'member');
    await mkdir(member, { recursive: true });
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', '/tmp/elsewhere');

    expect(cacheRootFor(at)).toBe(resolve(at, '.variance/cache'));
    expect(cacheRootFor(member)).toBe(resolve(at, '.variance/cache'));
    vi.unstubAllEnvs();
  });

  test('without the key it is inside the repository, whatever XDG_CACHE_HOME says', async () => {
    const at = await repository({ project: 'p' });
    const member = resolve(at, 'packages', 'member');
    await mkdir(member, { recursive: true });
    const inside = resolve(at, 'node_modules', '.cache', 'variance-authority');
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', '');
    vi.stubEnv('XDG_CACHE_HOME', '/xdg');
    expect(cacheRootFor(at)).toBe(inside);
    expect(cacheRootFor(member)).toBe(inside);
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', 'relative');
    expect(cacheRootFor(at)).toBe(inside);
    vi.unstubAllEnvs();
  });

  test('an absolute VARIANCE_AUTHORITY_CACHE is the cache directory itself', async () => {
    const at = await repository({ project: 'p' });
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', '/isolated');
    expect(cacheRootFor(at)).toBe(resolve('/isolated'));
    vi.unstubAllEnvs();
  });

  test('a worktree with no config writes inside itself and reads the primary checkout', async () => {
    const at = await checkout();
    const path = await worktree(at, resolve(at, 'primary', '.git', 'worktrees', 'feature'));
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', '');
    const layers = cacheLayers(path);
    vi.unstubAllEnvs();

    expect(layers.base.startsWith(resolve(at, 'primary', 'node_modules', '.cache', 'variance-authority'))).toBe(true);
    expect(layers.top.startsWith(resolve(path, 'node_modules', '.cache', 'variance-authority'))).toBe(true);
  });

  test('a `cacheRoot` that is not a path is refused, naming the file', async () => {
    const at = await repository({ cacheRoot: 7 });

    expect(() => cacheRootFor(at)).toThrow(`${resolve(at, 'variance.config.json')}: "cacheRoot" must be a directory path, not 7`);
  });

  test('with a relative `cacheRoot`, a worktree writes inside itself and reads the primary checkout', async () => {
    const at = await checkout();
    const path = await worktree(at, resolve(at, 'primary', '.git', 'worktrees', 'feature'));
    for (const where of [resolve(at, 'primary'), path]) {
      await writeFile(resolve(where, 'variance.config.json'), JSON.stringify({ cacheRoot: '.cache' }));
    }
    const layers = cacheLayers(path);

    expect(layers.base.startsWith(resolve(at, 'primary', '.cache', 'test-selection'))).toBe(true);
    expect(layers.top.startsWith(resolve(path, '.cache', 'test-selection'))).toBe(true);
  });
});

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

    expect(layeredFiles(layers, 'coverage.bin')).toEqual([
      resolve(layers.top, 'coverage.bin'),
      resolve(layers.base, 'coverage.bin'),
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

  test('a record asked for from a package is the record its repository wrote', async () => {
    const at = await mkdtemp(resolve(tmpdir(), 'va-layers-'));
    execFileSync('git', ['init', '--quiet', at]);
    const member = resolve(at, 'packages', 'member');
    await mkdir(member, { recursive: true });
    const cacheRoot = resolve(at, 'cache');

    expect(repositoryLayers(member, cacheRoot)).toEqual(repositoryLayers(at, cacheRoot));
    expect(testCoverageFile(member, { cacheRoot })).toBe(testCoverageFile(at, { cacheRoot }));
    expect(recordStore(member, 'storybook', cacheRoot)).toBe(recordStore(at, 'storybook', cacheRoot));
    expect(cacheLayers(member, cacheRoot).top).not.toBe(cacheLayers(at, cacheRoot).top);
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
    await writeTestCoverage(testCoverageFile(primary, { cacheRoot }), snapshot);

    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));
    const file = testCoverageFile(path, { cacheRoot });
    await seedTestCoverage(file, path, cacheRoot);

    expect((await readTestCoverage(file)).tests).toEqual(snapshot.tests);
    expect(file).not.toBe(testCoverageFile(primary, { cacheRoot }));
  });

  test('a worktree starts from the repository case index too, so its first run folds into the whole suite', async () => {
    const at = await checkout();
    const cacheRoot = resolve(at, 'cache');
    const primary = resolve(at, 'primary');
    const base = testCoverageFile(primary, { cacheRoot });
    const cases = encodeSetExecutionIndex({
      tests: [{ id: 'a > b', file: 'a.test.ts', name: 'b' }],
      modules: [],
      sets: new CrossingSets(1).pool(),
    });
    // The primary checkout's last run is its own, not the worktree's.
    await writeTestCoverage(base, snapshot, { index: cases, last: Buffer.from('{"files":[],"cases":[]}') });

    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));
    const file = testCoverageFile(path, { cacheRoot });
    await seedTestCoverage(file, path, cacheRoot);

    const seeded = caseSectionsAt(file);
    expect(seeded.index === undefined ? undefined : Buffer.from(seeded.index)).toEqual(cases);
    expect(seeded.last).toBeUndefined();
  });

  test('a worktree starts from a repository record that holds cases and no coverage, and it still narrows nothing', async () => {
    const at = await checkout();
    const cacheRoot = resolve(at, 'cache');
    const primary = resolve(at, 'primary');
    const base = testCoverageFile(primary, { cacheRoot });
    const cases = encodeSetExecutionIndex({
      tests: [{ id: 'a > b', file: 'a.test.ts', name: 'b' }],
      modules: [],
      sets: new CrossingSets(1).pool(),
    });
    await mkdir(dirname(base), { recursive: true });
    await writeFile(base, recordOfCases({ index: cases, last: Buffer.from('{"files":[],"cases":[]}') }));

    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));
    const file = testCoverageFile(path, { cacheRoot });
    await expect(seedTestCoverage(file, path, cacheRoot)).resolves.toEqual({ from: 'primary', file: base });

    const seeded = caseSectionsAt(file);
    expect(seeded.index === undefined ? undefined : Buffer.from(seeded.index)).toEqual(cases);
    expect(seeded.last).toBeUndefined();
    expect(withoutCoverage(file)).toBe(true);
    await expect(readTestCoverage(file)).rejects.toBeInstanceOf(RecordWithoutCoverage);
    await expect(stat(commitRunsFile(file))).rejects.toThrow();
  });

  test('a reader takes the repository snapshot without making a copy of it', async () => {
    const at = await checkout();
    const cacheRoot = resolve(at, 'cache');
    const primary = resolve(at, 'primary');
    await writeTestCoverage(testCoverageFile(primary, { cacheRoot }), snapshot);
    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));

    expect(await readableTestCoverage(path, { cacheRoot })).toBe(testCoverageFile(primary, { cacheRoot }));
    await expect(stat(testCoverageFile(path, { cacheRoot }))).rejects.toThrow();
  });

  test('a base this build cannot read leaves the worktree with nothing, not an error', async () => {
    const at = await checkout();
    const cacheRoot = resolve(at, 'cache');
    const primary = resolve(at, 'primary');
    const base = testCoverageFile(primary, { cacheRoot });
    await mkdir(dirname(base), { recursive: true });
    await writeFile(base, Buffer.from('not a snapshot this build knows'));

    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));
    const file = testCoverageFile(path, { cacheRoot });
    await expect(seedTestCoverage(file, path, cacheRoot)).resolves.toBeUndefined();
    await expect(stat(file)).rejects.toThrow();
  });

  test('a caller that named its own file is not seeded into', async () => {
    const at = await checkout();
    const cacheRoot = resolve(at, 'cache');
    const primary = resolve(at, 'primary');
    await writeTestCoverage(testCoverageFile(primary, { cacheRoot }), snapshot);
    const path = await worktree(at, resolve(primary, '.git', 'worktrees', 'feature'));
    const mine = resolve(path, 'mine.bin');

    await seedTestCoverage(mine, path, cacheRoot);
    await expect(stat(mine)).rejects.toThrow();
    await expect(stat(testCoverageFile(path, { cacheRoot }))).rejects.toThrow();
  });

  test('a reader passes over a fetched mainline record this build does not read, as the first run does, for the layer beneath', async () => {
    const at = await realpath(await mkdtemp(resolve(tmpdir(), 'va-layers-fetched-')));
    const primary = resolve(at, 'primary');
    const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
    await mkdir(primary);
    run(primary, 'init', '--quiet');
    await writeFile(resolve(primary, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } } }));
    run(primary, 'add', '-A');
    run(primary, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'first');
    const [path, other] = [resolve(at, 'feature'), resolve(at, 'other')];
    run(primary, 'worktree', 'add', '--quiet', '-b', 'feature', path);
    run(primary, 'worktree', 'add', '--quiet', '-b', 'other', other);
    const cacheRoot = resolve(at, 'cache');
    const beneath = testCoverageFile(primary, { cacheRoot, suite: 'unit' });
    await writeTestCoverage(beneath, snapshot);
    const commit = 'c'.repeat(40);
    const fetched = resolve(mainlineReadRoot(cacheRoot, 'unit'), commit, 'coverage.bin');
    await mkdir(dirname(fetched), { recursive: true });
    await writeFile(fetched, Buffer.from('not a snapshot this build knows'));
    await writeFetchedMainline(cacheRoot, 'unit', { mainline: 'main', commit, fetched: new Date().toISOString() });

    expect(await readableTestCoverage(path, { cacheRoot, suite: 'unit' })).toBe(beneath);
    await expect(seedTestCoverage(testCoverageFile(path, { cacheRoot, suite: 'unit' }), path, cacheRoot)).resolves.toMatchObject({
      from: 'primary',
      file: beneath,
    });

    // One that reads is the base, over the same layer.
    await writeTestCoverage(fetched, snapshot);
    expect(await readableTestCoverage(other, { cacheRoot, suite: 'unit' })).toBe(fetched);

    // So is one whose run instrumented nothing: its cases are laid, and it
    // narrows nothing.
    const cases = encodeSetExecutionIndex({ tests: [{ id: 'a > b', file: 'a.test.ts', name: 'b' }], modules: [], sets: new CrossingSets(1).pool() });
    await writeFile(fetched, recordOfCases({ index: cases }));
    const laid = testCoverageFile(other, { cacheRoot, suite: 'unit' });
    await expect(seedTestCoverage(laid, other, cacheRoot)).resolves.toMatchObject({ from: 'mainline' });
    const seeded = caseSectionsAt(laid);
    expect(seeded.index === undefined ? undefined : Buffer.from(seeded.index)).toEqual(cases);
    expect(withoutCoverage(laid)).toBe(true);
  });
});
