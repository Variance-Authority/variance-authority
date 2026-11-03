import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import { KEEP_COMMITS } from '@variance-authority/core/share';
import { keptBehind, type Env } from '../share-lines.js';
import { describePublish, mainlineIndex, publishRun } from './share.js';

/**
 * A checkout behind the mainline's tip reads the record at its merge base.
 *
 * Against a real repository whose bare `origin` is the share, because the
 * records kept by commit are git refs and the merge base is git's answer.
 */

const run = promisify(execFile);
const PUSH: Env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-at-commit-'));
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'cache'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe('a mainline record kept at its commit', () => {
  it('answers a checkout behind the tip from its merge base, else the nearest kept behind it, else the latest', async () => {
    const { dir, commits } = await repositoryOf(3);
    const config = { project: 'web', report: join(home, 'report.json'), share: { kind: 'git', mainlines: ['main'] } } as Config;
    const first = await publishRun(config, await reportAt(commits[0]!), { env: PUSH, cwd: dir });
    expect(describePublish(config, first)).toContain(`kept the record at ${commits[0]!} beside the latest, for 14 days or 200 commits.`);
    await publishRun(config, await reportAt(commits[2]!), { env: PUSH, cwd: dir });

    await git(dir, 'checkout', '--quiet', '-b', 'release', commits[0]!);
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'cold-0'));
    expect(await mainlineIndex(config, { env: {}, cwd: dir })).toMatchObject({ commit: commits[0], distance: 0, from: 'share' });

    // `commits[1]`'s job has not published: the nearest behind it charges the
    // checkout with no commit it lacks, where the latest would charge it one.
    await git(dir, 'checkout', '--quiet', '-b', 'unkept', commits[1]!);
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'cold-1'));
    expect(await mainlineIndex(config, { env: {}, cwd: dir })).toMatchObject({ commit: commits[0], distance: 1, from: 'share' });

    await git(dir, 'push', '--quiet', 'origin', `:refs/variance/at/${commits[0]!}/mainline/main`);
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'cold-2'));
    expect(await mainlineIndex(config, { env: {}, cwd: dir })).toMatchObject({ commit: commits[2], distance: -1, from: 'share' });
  });

  it(`walks back past ${String(KEEP_COMMITS)} commits to a record kept by a sparse mainline`, async () => {
    const dir = await mkdtemp(join(home, 'sparse-'));
    await git(dir, 'init', '--quiet', '-b', 'main');
    const stream = Array.from({ length: KEEP_COMMITS + 2 }, (_, index) => [
      'commit refs/heads/main',
      `mark :${String(index + 1)}`,
      `committer Test <test@example.com> ${String(index)} +0000`,
      'data 0',
      ...(index === 0 ? [] : [`from :${String(index)}`]),
      '',
    ].join('\n')).join('');
    await new Promise<void>((done, failed) => {
      const child = execFile('git', ['fast-import', '--quiet'], { cwd: dir }, (error) => (error ? failed(error) : done()));
      child.stdin!.end(stream);
    });
    const oldest = await git(dir, 'rev-list', '--max-parents=0', 'main');

    const walked: string[] = [];
    for await (const commit of keptBehind('main', new Set([oldest]), dir)) walked.push(commit);

    expect(walked).toEqual([oldest]);
  });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

/** A checkout of `main` with `count` commits, pushed to a bare `origin` and fetched back. */
async function repositoryOf(count: number): Promise<{ dir: string; commits: string[] }> {
  const dir = await mkdtemp(join(home, 'repo-'));
  const origin = await mkdtemp(join(home, 'origin-'));
  await git(origin, 'init', '--bare', '--quiet');
  await git(dir, 'init', '--quiet', '-b', 'main');
  await git(dir, 'config', 'user.email', 'test@example.com');
  await git(dir, 'config', 'user.name', 'Test');
  await git(dir, 'remote', 'add', 'origin', origin);
  const commits: string[] = [];
  for (let index = 0; index < count; index += 1) {
    await git(dir, 'commit', '--quiet', '--allow-empty', '-m', `commit ${String(index)}`);
    commits.push(await git(dir, 'rev-parse', 'HEAD'));
  }
  await git(dir, 'push', '--quiet', 'origin', 'main');
  await git(dir, 'fetch', '--quiet', 'origin');
  return { dir, commits };
}

async function reportAt(commit: string): Promise<string> {
  const path = join(home, `run-${commit}.json`);
  const report = {
    runVersion: 1,
    identity: { renderer: 'playwright-chromium', engine: 'chromium@131', platform: 'linux/x64', deviceScaleFactor: 1, fonts: [] },
    observations: [],
    run: { id: 'run-1', commit },
    composition: { subjects: ['page/footer'], components: [] },
  };
  await writeFile(path, JSON.stringify(report));
  return path;
}
