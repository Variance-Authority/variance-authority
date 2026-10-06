import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { takeCarried } from './take-carried.mjs';

/**
 * What a pull request's earlier push left, taken as this checkout's own layer.
 *
 * The record names the commits its tests last ran at, and a selection diffs
 * each test from its commit. Those are the merge commits of earlier pushes:
 * GitHub moves `refs/pull/<n>/merge` on every push, so no ref a clone fetches
 * holds them, and they are fetched by name. A suite whose commits cannot all
 * be had is not taken, and the checkout reads the mainline's record as it
 * would with nothing carried.
 */

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function commitIn(repo: string, file: string, text: string): Promise<string> {
  await writeFile(join(repo, file), text);
  git(repo, 'add', file);
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', file);
  return git(repo, 'rev-parse', 'HEAD');
}

/** An upstream, a clone of its `main`, and a commit only the upstream holds, by name and under no ref. */
async function pullRequest(): Promise<{ upstream: string; clone: string; kept: string; gone: string }> {
  const at = await mkdtemp(join(tmpdir(), 'take-carried-'));
  const upstream = join(at, 'upstream');
  await mkdir(upstream);
  git(upstream, 'init', '-q', '-b', 'main');
  git(upstream, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  await commitIn(
    upstream,
    'variance.config.json',
    JSON.stringify({ suites: { chromium: { kind: 'e2e' }, unit: { kind: 'unit' } } }),
  );
  const kept = await commitIn(upstream, 'a.ts', 'a\n');
  git(upstream, 'checkout', '-q', '-b', 'pull');
  const gone = await commitIn(upstream, 'b.ts', 'b\n');
  git(upstream, 'checkout', '-q', 'main');
  git(upstream, 'branch', '-q', '-D', 'pull');
  const clone = join(at, 'clone');
  git(at, 'clone', '-q', '--no-local', upstream, clone);
  return { upstream, clone, kept, gone };
}

async function carry(dir: string, suite: string, runs: object): Promise<void> {
  await mkdir(join(dir, suite), { recursive: true });
  await writeFile(join(dir, suite, 'coverage.bin'), 'carried');
  await writeFile(join(dir, suite, 'coverage.runs.json'), JSON.stringify(runs));
}

const runsAt = (commit: string, standing: readonly string[] = []) => ({
  commit,
  first: '2026-10-06T00:00:00.000Z',
  latest: '2026-10-06T00:00:00.000Z',
  runs: 1,
  files: ['a.test.ts'],
  standing: standing.map((at) => ({ commit: at, files: ['b.test.ts'] })),
});

describe('a pull request reads from what its last push ran', () => {
  it('takes a suite whose commits the clone holds as its own layer', async () => {
    const { clone, kept } = await pullRequest();
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept));

    const taken = await takeCarried(clone, carried);

    expect(taken).toEqual({ taken: ['unit'], left: [] });
    const own = testCoverageFile(clone, { suite: 'unit' });
    expect(readFileSync(own, 'utf8')).toBe('carried');
    expect(existsSync(join(dirname(own), 'coverage.runs.json'))).toBe(true);
  });

  it('fetches by name a commit a test stands on that no ref holds', async () => {
    const { clone, kept, gone } = await pullRequest();
    expect(() => git(clone, 'cat-file', '-e', `${gone}^{commit}`)).toThrow();
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept, [gone]));

    expect(await takeCarried(clone, carried)).toEqual({ taken: ['unit'], left: [] });
    expect(git(clone, 'cat-file', '-t', gone)).toBe('commit');
  });

  it('leaves a suite whose commit the remote no longer has, and says which', async () => {
    const { clone, kept } = await pullRequest();
    const carried = join(clone, '.carried');
    const lost = 'f'.repeat(40);
    await carry(carried, 'unit', runsAt(kept, [lost]));
    await carry(carried, 'chromium', runsAt(kept));

    const taken = await takeCarried(clone, carried);

    expect(taken.taken).toEqual(['chromium']);
    expect(taken.left).toEqual([{ suite: 'unit', missing: [lost] }]);
    expect(existsSync(testCoverageFile(clone, { suite: 'unit' }))).toBe(false);
  });

  it('lays nothing over a record the checkout already has', async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, 'mine');
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept));

    expect(await takeCarried(clone, carried)).toEqual({ taken: [], left: [{ suite: 'unit', held: own }] });
    expect(readFileSync(own, 'utf8')).toBe('mine');
  });

  it('takes nothing when nothing was carried', async () => {
    const { clone } = await pullRequest();
    expect(await takeCarried(clone, join(clone, '.nothing'))).toEqual({ taken: [], left: [] });
  });
});
