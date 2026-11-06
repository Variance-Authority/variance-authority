import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { instrumentationId } from '../instrument/index.js';
import { mainlineReadRoot, writeFetchedMainline, writeTestCoverage } from './index.js';
import { cachedSuite, nearestRecord } from './record-location.js';

const temporary: string[] = [];
const held = { version: 3, instrumentation: instrumentationId('presence'), tests: [], modules: [] } as const;

/** A real repository with one commit, and a worktree cut from it. */
async function checkouts(): Promise<{ readonly at: string; readonly primary: string; readonly worktree: string }> {
  // Git writes a worktree's pointer through symlinks, and a temporary directory may sit behind one.
  const at = await realpath(await mkdtemp(resolve(tmpdir(), 'va-nearest-record-')));
  temporary.push(at);
  const primary = resolve(at, 'primary');
  const worktree = resolve(at, 'feature');
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore' });
  };
  git('init', '--quiet', primary);
  git('-C', primary, 'commit', '--quiet', '--allow-empty', '-m', 'first');
  git('-C', primary, 'worktree', 'add', '--quiet', '-b', 'feature', worktree);
  const suites = JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } } });
  await Promise.all([primary, worktree].map((root) => writeFile(resolve(root, 'variance.config.json'), suites)));
  return { at, primary, worktree };
}

async function hold(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeTestCoverage(file, held);
}

describe('whose record answers a worktree', () => {
  afterEach(async () => {
    await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('is its own, over the fetched mainline, over the primary checkout, and its own again with none held', async () => {
    const { at, primary, worktree } = await checkouts();
    const asked = { cacheRoot: resolve(at, 'cache'), suite: 'unit' };
    const own = nearestRecord(worktree, asked).file;
    const below = nearestRecord(primary, asked).file;
    const commit = 'c'.repeat(40);
    const mainline = resolve(mainlineReadRoot(asked.cacheRoot, 'unit'), commit, 'coverage.bin');

    expect(nearestRecord(worktree, asked)).toEqual({ file: own, origin: 'own' });

    await hold(below);
    expect(nearestRecord(worktree, asked)).toEqual({ file: below, origin: 'primary' });

    await hold(mainline);
    await writeFetchedMainline(asked.cacheRoot, 'unit', { mainline: 'main', commit, fetched: new Date().toISOString() });
    expect(nearestRecord(worktree, asked)).toEqual({ file: mainline, origin: 'mainline' });

    // A reader that worked the selection out judges by it; one that found none, or never asked, takes what was fetched.
    expect(nearestRecord(worktree, { ...asked, selected: 'main' })).toEqual({ file: mainline, origin: 'mainline' });
    expect(nearestRecord(worktree, { ...asked, selected: 'release' })).toEqual({ file: below, origin: 'primary' });
    expect(nearestRecord(worktree, { ...asked, selected: undefined })).toEqual({ file: mainline, origin: 'mainline' });

    await hold(own);
    expect(nearestRecord(worktree, asked)).toEqual({ file: own, origin: 'own' });
  });
});

describe('the suite of a cached record', () => {
  it('is the one its path names, and none for the repository one record', () => {
    expect(cachedSuite('suites/unit/coverage.bin')).toBe('unit');
    expect(cachedSuite('coverage.bin')).toBeUndefined();
  });
});
