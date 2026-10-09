import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { commitRunsAfter, commitRunsFile, readCommitRuns, type RecordedTests } from './commit-runs.js';
import { installAfter, installKey, keepRecordedInstall, sameInstall, shardsInstall } from './kept-install.js';
import { keptTexts, landedTree } from './kept-texts.js';

/**
 * The install a run ran on is the lockfiles and manifests on disk while it ran.
 * These keep it over a real repository, the way a landing does, and merge it
 * into the runs at one commit the way the runs record does.
 */

async function checkout<T>(run: (root: string, cacheRoot: string) => Promise<T>): Promise<T> {
  const scratch = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-kept-install-')));
  const root = resolve(scratch, 'repository');
  const cacheRoot = resolve(scratch, 'cache');
  try {
    await mkdir(resolve(root, 'packages/a'), { recursive: true });
    await writeFile(resolve(root, 'package.json'), '{"name":"root"}\n');
    await writeFile(resolve(root, 'packages/a/package.json'), '{"name":"a"}\n');
    await writeFile(resolve(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    await writeFile(resolve(root, 'index.ts'), 'export {};\n');
    const git = async (...args: string[]): Promise<string> =>
      (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
    await git('init', '--quiet');
    await git('config', 'user.email', 'fixture@example.invalid');
    await git('config', 'user.name', 'Fixture');
    await git('add', '--all');
    await git('commit', '--quiet', '--message', 'an install');
    return await run(root, cacheRoot);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

describe('the install a run ran on', () => {
  it('is the commit\'s exactly over a clean tree', async () => {
    await checkout(async (root, cacheRoot) => {
      expect(await keepRecordedInstall(await landedTree(root, cacheRoot))).toEqual({});
    });
  });

  it('keeps each edited lockfile and manifest, names a deleted one, and leaves source alone', async () => {
    await checkout(async (root, cacheRoot) => {
      const bumped = "lockfileVersion: '9.0'\n\npackages: {}\n";
      await writeFile(resolve(root, 'pnpm-lock.yaml'), bumped);
      await rm(resolve(root, 'packages/a/package.json'));
      await mkdir(resolve(root, 'packages/b'));
      await writeFile(resolve(root, 'packages/b/package.json'), '{"name":"b"}\n');
      await writeFile(resolve(root, 'index.ts'), 'export const edited = 1;\n');

      const installed = await keepRecordedInstall(await landedTree(root, cacheRoot));

      expect(installed).toEqual({
        'packages/a/package.json': null,
        'packages/b/package.json': digestString('{"name":"b"}\n'),
        'pnpm-lock.yaml': digestString(bumped),
      });
      expect(keptTexts(root, cacheRoot)(installed!['pnpm-lock.yaml']!)).toBe(bumped);
    });
  });

  it('cannot be said outside a checkout', async () => {
    const scratch = await mkdtemp(resolve(tmpdir(), 'variance-kept-install-'));
    try {
      expect(await keepRecordedInstall(await landedTree(scratch, resolve(scratch, 'cache')))).toBeUndefined();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe('the install the runs at one commit ran on', () => {
  const bumped = { 'yarn.lock': 'digest:bumped' };

  it('stays when another run lands over the same install', () => {
    expect(installAfter({ files: ['a.test.ts'], installed: bumped }, ['b.test.ts'], { ...bumped })).toEqual(bumped);
  });

  it('is the latest run\'s when that run observed every test the earlier runs did', () => {
    expect(installAfter({ files: ['a.test.ts'], installed: bumped }, ['a.test.ts', 'b.test.ts'], {})).toEqual({});
    expect(installAfter({ files: ['a.test.ts'] }, ['a.test.ts'], bumped)).toEqual(bumped);
  });

  it('is unknown when the runs at one commit ran on two installs', () => {
    expect(installAfter({ files: ['a.test.ts'], installed: bumped }, ['b.test.ts'], {})).toBeUndefined();
    expect(installAfter({ files: ['a.test.ts'] }, ['b.test.ts'], bumped)).toBeUndefined();
    expect(installAfter({ files: ['a.test.ts'], installed: bumped }, ['a.test.ts'], undefined)).toBeUndefined();
  });

  it('is written into the runs record, and left out where it is not known', () => {
    const at = (commit: string, files: readonly string[]): RecordedTests => ({
      instrumentation: 'fixture',
      commit,
      tests: files.map((file) => ({ file })),
    });
    const first = commitRunsAfter(at('base', ['a.test.ts']), undefined, at('head', ['a.test.ts']), bumped);
    expect(first.installed).toEqual(bumped);

    const partial = commitRunsAfter(at('head', ['a.test.ts', 'b.test.ts']), first, at('head', ['b.test.ts']), {});
    expect(partial).not.toHaveProperty('installed');

    const shards = commitRunsAfter(at('head', ['a.test.ts']), undefined, at('next', ['a.test.ts']));
    expect(shards).not.toHaveProperty('installed');
  });

  it('goes with the tests a later run leaves standing, for as long as they stand', () => {
    const at = (commit: string, files: readonly string[]): RecordedTests => ({
      instrumentation: 'fixture',
      commit,
      tests: files.map((file) => ({ file })),
    });
    const ran = commitRunsAfter(at('base', ['a.test.ts', 'b.test.ts']), undefined, at('head', ['a.test.ts', 'b.test.ts']), bumped);
    const next = commitRunsAfter(at('head', ['a.test.ts', 'b.test.ts']), ran, at('next', ['a.test.ts']), {});
    expect(next.standing).toEqual([{ commit: 'head', files: ['b.test.ts'], installed: bumped }]);

    const later = commitRunsAfter(at('next', ['a.test.ts', 'b.test.ts']), next, at('later', ['a.test.ts']), {});
    expect(later.standing).toEqual([{ commit: 'head', files: ['b.test.ts'], installed: bumped }]);
  });

  it('is read as unknown when the record holds something other than an install', async () => {
    const scratch = await mkdtemp(resolve(tmpdir(), 'variance-kept-install-read-'));
    try {
      const coverage = resolve(scratch, 'coverage.bin');
      const install = (installed: unknown) => ({ commit: 'head', first: '', latest: '', runs: 1, files: [], installed });
      for (const installed of [null, 'yarn.lock', ['yarn.lock'], { 'yarn.lock': 7 }]) {
        await writeFile(commitRunsFile(coverage), JSON.stringify({ ...install(installed), standing: [{ commit: 'base', files: ['b.test.ts'], installed }] }));
        const read = await readCommitRuns(coverage);
        expect(read).not.toHaveProperty('installed');
        expect(read?.standing).toEqual([{ commit: 'base', files: ['b.test.ts'] }]);
      }
      await writeFile(commitRunsFile(coverage), JSON.stringify(install({ 'yarn.lock': null })));
      expect((await readCommitRuns(coverage))?.installed).toEqual({ 'yarn.lock': null });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe('the install a fold of shards ran on', () => {
  const bumped = { 'yarn.lock': 'digest:bumped' };
  const shard = (files: readonly string[], runs: { commit?: string; runs?: number; files?: readonly string[]; installed?: typeof bumped }) => ({
    tests: { commit: 'head', tests: files.map((file) => ({ file })) },
    runs: { commit: 'head', runs: 1, files, installed: bumped, ...runs },
  });

  it('is the one every shard\'s record names, whatever order its paths were written in', () => {
    expect(shardsInstall([shard(['a.test.ts'], {}), shard(['b.test.ts'], { installed: { ...bumped } })])).toEqual(bumped);
    expect(shardsInstall([shard(['a.test.ts'], { installed: {} })])).toEqual({});
  });

  it('is unknown when a shard\'s record does not speak for every test its snapshot holds, at its commit', () => {
    const fine = shard(['a.test.ts'], {});
    for (const other of [
      shard(['b.test.ts'], { commit: 'base' }),
      shard(['b.test.ts'], { runs: 0 }),
      shard(['b.test.ts', 'c.test.ts'], { files: ['b.test.ts'] }),
      shard(['b.test.ts'], { installed: {} }),
      shard(['b.test.ts'], { installed: undefined }),
      { ...shard(['b.test.ts'], {}), runs: undefined },
    ]) {
      expect(shardsInstall([fine, other])).toBeUndefined();
    }
  });
});

describe('two installs are one install', () => {
  const written = { 'yarn.lock': 'digest:lock', 'package.json': 'digest:root', 'packages/a/package.json': null };

  it('when they name the same paths with the same texts, whatever order the paths were written in', () => {
    const reordered = { 'packages/a/package.json': null, 'package.json': 'digest:root', 'yarn.lock': 'digest:lock' };
    expect(installKey(reordered)).toBe(installKey(written));
    expect(sameInstall(reordered, written)).toBe(true);
  });

  it('not when a path names another text, or none', () => {
    for (const other of [{ ...written, 'yarn.lock': 'digest:bumped' }, { ...written, 'package.json': null }]) {
      expect(installKey(other)).not.toBe(installKey(written));
      expect(sameInstall(other, written)).toBe(false);
    }
  });
});
