import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { bundleCarried } from './bundle-carried.mjs';
import { takeCarried } from './take-carried.mjs';

/**
 * What a pull request's earlier push left, taken as this checkout's own layer.
 *
 * The record names the commits its tests last ran at, and a selection diffs
 * each test from its commit. Those are the merge commits of earlier pushes:
 * GitHub moves `refs/pull/<n>/merge` on every push, so no ref a clone fetches
 * holds them, and they are fetched by name. A merge `check.yml` made itself,
 * with the commit the mainline's record was made at, is on no remote: the push
 * that made it bundles it beside the records. A suite whose commits cannot all
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

const LANDED = '2026-10-06T00:00:00.000Z';
const runsAt = (commit: string, standing: readonly string[] = []) => ({
  commit,
  latest: LANDED,
  runs: 1,
  landings: [{ files: ['a.test.ts'], first: LANDED, latest: LANDED, runs: 1 }],
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

  it('leaves a suite whose record names no commit its tests ran at', async () => {
    const { clone } = await pullRequest();
    const carried = join(clone, '.carried');
    await mkdir(join(carried, 'unit'), { recursive: true });
    await writeFile(join(carried, 'unit', 'coverage.bin'), 'carried');

    expect(await takeCarried(clone, carried)).toEqual({ taken: [], left: [{ suite: 'unit', unlisted: true }] });
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

  it('takes a merge no remote holds from the bundle the last push left beside the records', async () => {
    const { clone, kept } = await pullRequest();
    const earlier = join(dirname(clone), 'earlier');
    git(dirname(clone), 'clone', '-q', '--no-local', join(dirname(clone), 'upstream'), earlier);
    await commitIn(earlier, 'c.ts', 'c\n');
    const head = git(earlier, 'rev-parse', 'HEAD');
    git(earlier, 'checkout', '-q', '--detach', kept);
    git(earlier, '-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '-q', '--no-ff', '--no-edit', head);
    const merge = git(earlier, 'rev-parse', 'HEAD');
    const carried = join(earlier, '.carried');
    await carry(carried, 'unit', runsAt(merge, [kept]));

    expect(await bundleCarried(earlier, carried, 'refs/remotes/origin/main')).toEqual({ bundled: [merge], absent: [] });
    expect(git(earlier, 'for-each-ref', 'refs/carried/')).toBe('');
    expect(() => git(clone, 'cat-file', '-e', `${merge}^{commit}`)).toThrow();

    expect(await takeCarried(clone, carried)).toEqual({ taken: ['unit'], left: [] });
    expect(git(clone, 'rev-parse', `${merge}^2`)).toBe(head);
    expect(git(clone, 'for-each-ref', 'refs/carried/')).toBe('');
  });

  it('bundles the commits the clone holds, and names the ones it does not', async () => {
    const { clone, kept, gone } = await pullRequest();
    const carried = join(clone, '.carried');
    const lost = 'f'.repeat(40);
    git(clone, 'fetch', '-q', 'origin', gone);
    await carry(carried, 'unit', runsAt(kept, [gone, lost]));

    expect(await bundleCarried(clone, carried, 'refs/remotes/origin/main')).toEqual({ bundled: [gone], absent: [lost] });
    expect(git(clone, 'bundle', 'list-heads', join(carried, 'commits.bundle'))).toContain(gone);
  });

  it('says the bundle did not read, and leaves the suite whose commit was in it', async () => {
    const { clone } = await pullRequest();
    const carried = join(clone, '.carried');
    const lost = 'f'.repeat(40);
    await carry(carried, 'unit', runsAt(lost));
    await writeFile(join(carried, 'commits.bundle'), 'not a bundle');

    const taken = await takeCarried(clone, carried);

    expect(taken.left).toEqual([{ suite: 'unit', missing: [lost] }]);
    expect(taken.unbundled).toMatch(/commits\.bundle/u);
  });

  it('bundles nothing when every commit the records name is on the mainline', async () => {
    const { clone, kept } = await pullRequest();
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept));

    expect(await bundleCarried(clone, carried, 'refs/remotes/origin/main')).toEqual({ bundled: [], absent: [] });
    expect(existsSync(join(carried, 'commits.bundle'))).toBe(false);
  });
});
