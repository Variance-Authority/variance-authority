import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { repositoryLayers } from './cache-layers.js';
import { lastFetchedMainline } from './mainline-layer.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const started = vi.mocked(execFileSync);
const gits = (): number => started.mock.calls.filter(([file]) => file === 'git').length;

/** A real repository with one commit, and a worktree cut from it. */
async function worktree(): Promise<string> {
  const at = await mkdtemp(resolve(tmpdir(), 'va-layers-git-'));
  const primary = resolve(at, 'primary');
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore' });
  };
  git('init', '--quiet', primary);
  git('-C', primary, 'commit', '--quiet', '--allow-empty', '-m', 'first');
  git('-C', primary, 'worktree', 'add', '--quiet', '-b', 'feature', resolve(at, 'feature'));

  return resolve(at, 'feature');
}

describe('how often laying out a worktree\'s cache starts git', () => {
  beforeEach(() => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', '');
    return () => vi.unstubAllEnvs();
  });

  // The primary checkout is read from the worktree's own git layout, which
  // already says it is a checkout's root, and a worktree holding `.git` is its
  // own checkout's top: git is asked for neither.
  test('never, for the worktree or for the checkout it was cut from', async () => {
    const path = await worktree();
    started.mockClear();

    repositoryLayers(path);

    expect(gits()).toBe(0);
  });

  test('never when the fetched mainline is looked up before anything else asked', async () => {
    const path = await worktree();
    const suites = { suites: { unit: { kind: 'unit', carry: 'share' } } };
    await writeFile(resolve(path, 'variance.config.json'), JSON.stringify(suites));
    started.mockClear();

    lastFetchedMainline(path, 'unit');

    expect(gits()).toBe(0);
  });
});
