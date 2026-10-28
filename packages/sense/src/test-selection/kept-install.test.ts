import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { commitRunsAfter, commitRunsFile, readCommitRuns, type CommitRuns } from './commit-runs.js';
import { installKey, keepRecordedInstall, sameInstall, shardsInstall, shardsTexts, type KeptInstall } from './kept-install.js';
import { keptTexts, landedTree } from './kept-texts.js';
import { whatLanded } from './landings.js';

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
  const at = (commit: string, files: readonly string[]) => ({
    instrumentation: 'fixture',
    commit,
    tests: files.map((file) => ({ file, complete: true })),
  });
  /** A run of `a` at `head` over `one`, then a run of `second` there over `two`. */
  const twice = (one: KeptInstall | undefined, two: KeptInstall | undefined, second = ['b.test.ts']) => {
    const first = commitRunsAfter(at('base', ['a.test.ts', 'b.test.ts']), undefined, at('head', ['a.test.ts']), one);
    return commitRunsAfter(at('head', ['a.test.ts', 'b.test.ts']), first, at('head', second), two);
  };
  /** What the record's landings say together, the install among it. */
  const landed = (runs: CommitRuns) => whatLanded(runs.landings);

  it('stays when another run lands over the same install', () => {
    expect(landed(twice(bumped, { ...bumped })).installed).toEqual(bumped);
  });

  it('is the latest run\'s when that run finished every test the earlier runs did', () => {
    expect(landed(twice(bumped, {}, ['a.test.ts', 'b.test.ts'])).installed).toEqual({});
    expect(landed(twice(undefined, bumped, ['a.test.ts'])).installed).toEqual(bumped);
  });

  it('is unknown when the runs at one commit ran on two installs', () => {
    expect(landed(twice(bumped, {}))).not.toHaveProperty('installed');
    expect(landed(twice(undefined, bumped))).not.toHaveProperty('installed');
    expect(landed(twice(bumped, undefined, ['a.test.ts']))).not.toHaveProperty('installed');
  });

  it('is written into the landing of the run that ran on it, and left out where it is not known', () => {
    const first = commitRunsAfter(at('base', ['a.test.ts']), undefined, at('head', ['a.test.ts']), bumped);
    expect(first.landings).toMatchObject([{ files: ['a.test.ts'], installed: bumped }]);

    const partial = commitRunsAfter(at('head', ['a.test.ts', 'b.test.ts']), first, at('head', ['b.test.ts']), {});
    expect(landed(partial)).not.toHaveProperty('installed');

    const shards = commitRunsAfter(at('head', ['a.test.ts']), undefined, at('next', ['a.test.ts']));
    expect(shards.landings).toHaveLength(1);
    expect(shards.landings[0]).not.toHaveProperty('installed');
  });

  it('goes with the tests a later run leaves standing, for as long as they stand', () => {
    const ran = commitRunsAfter(at('base', ['a.test.ts', 'b.test.ts']), undefined, at('head', ['a.test.ts', 'b.test.ts']), bumped);
    const next = commitRunsAfter(at('head', ['a.test.ts', 'b.test.ts']), ran, at('next', ['a.test.ts']), {});
    const { first, latest } = ran.landings[0]!;
    expect(next.standing).toEqual([{ commit: 'head', files: ['b.test.ts'], installed: bumped, first, latest, runs: 1 }]);

    const later = commitRunsAfter(at('next', ['a.test.ts', 'b.test.ts']), next, at('later', ['a.test.ts']), {});
    expect(later.standing).toEqual([{ commit: 'head', files: ['b.test.ts'], installed: bumped, first, latest, runs: 1 }]);
  });

  it('is read as unknown when the record holds something other than an install', async () => {
    const scratch = await mkdtemp(resolve(tmpdir(), 'variance-kept-install-read-'));
    try {
      const coverage = resolve(scratch, 'coverage.bin');
      const install = (installed: unknown) => ({ commit: 'head', latest: '', runs: 1, landings: [{ files: ['a.test.ts'], installed }] });
      for (const installed of [null, 'yarn.lock', ['yarn.lock'], { 'yarn.lock': 7 }]) {
        await writeFile(commitRunsFile(coverage), JSON.stringify({ ...install(installed), standing: [{ commit: 'base', files: ['b.test.ts'], installed }] }));
        const read = await readCommitRuns(coverage);
        expect(read?.landings).toEqual([{ files: ['a.test.ts'] }]);
        expect(read?.standing).toEqual([{ commit: 'base', files: ['b.test.ts'] }]);
      }
      await writeFile(commitRunsFile(coverage), JSON.stringify(install({ 'yarn.lock': null })));
      expect(whatLanded((await readCommitRuns(coverage))!.landings).installed).toEqual({ 'yarn.lock': null });
      // Texts name a digest for every path: a module deleted is no text a test ran over.
      const ran = (texts: unknown) => ({ commit: 'head', latest: '', runs: 1, landings: [{ files: ['a.test.ts'], texts }] });
      for (const texts of [null, 'src/a.ts', { 'src/a.ts': null }]) {
        await writeFile(commitRunsFile(coverage), JSON.stringify({ ...ran(texts), standing: [{ commit: 'base', files: ['b.test.ts'], texts }] }));
        const read = await readCommitRuns(coverage);
        expect(read?.landings).toEqual([{ files: ['a.test.ts'] }]);
        expect(read?.standing).toEqual([{ commit: 'base', files: ['b.test.ts'] }]);
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe('the install a fold of shards ran on', () => {
  const bumped = { 'yarn.lock': 'digest:bumped' };
  // A shard's record says what its landings finished, and the install they ran on.
  const shard = (files: readonly string[], runs: { commit?: string; runs?: number; files?: readonly string[]; installed?: typeof bumped }) => {
    const { files: finished = files, installed: _installed, ...record } = runs;
    const installed = 'installed' in runs ? runs.installed : bumped;
    return {
      tests: { commit: 'head', tests: files.map((file) => ({ file })) },
      runs: { commit: 'head', runs: 1, ...record, landings: [{ files: finished, ...(installed === undefined ? {} : { installed }) }] },
    };
  };

  it('is the one every shard\'s record names, whatever order its paths were written in', () => {
    const two = { 'package.json': 'digest:root', 'yarn.lock': 'digest:bumped' };
    const reordered = { 'yarn.lock': 'digest:bumped', 'package.json': 'digest:root' };
    expect(shardsInstall([shard(['a.test.ts'], { installed: two }), shard(['b.test.ts'], { installed: reordered })])).toEqual(two);
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

  it('reads the texts the shards ran over as it reads the install', () => {
    const edited = { 'src/a.ts': 'digest:edited' };
    // A shard's own landing names its texts; its record names none of its own.
    const ran = (files: readonly string[], texts?: typeof edited) => ({
      ...shard(files, {}),
      runs: { ...shard(files, {}).runs, landings: [{ files, first: '', latest: '', runs: 1, ...(texts === undefined ? {} : { texts }) }] },
    });
    expect(shardsTexts([ran(['a.test.ts'], edited), ran(['b.test.ts'], { ...edited })])).toEqual(edited);
    expect(shardsTexts([ran(['a.test.ts'], {}), ran(['b.test.ts'], {})])).toEqual({});
    expect(shardsTexts([ran(['a.test.ts'], edited), ran(['b.test.ts'], {})])).toBeUndefined();
    expect(shardsTexts([ran(['a.test.ts'], edited), ran(['b.test.ts'])])).toBeUndefined();
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
