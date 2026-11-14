import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLineCell, publishLine, type ShareEntry } from '@variance-authority/core/share';
import type { Config } from '../config.js';
import { EXIT_CLEAN, OperatorError } from '../exit.js';
import { parseArgs } from '../parse.js';
import { keptBehind, type Env } from '../share-lines.js';
import { nearestHolding } from './mainline-entry.js';
import { purgeLines, runSharePurge } from './share-purge.js';
import { describePublish, mainlineIndex, publishRun, shareLines } from './share.js';

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
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
});

describe('a mainline record kept at its commit', () => {
  it('answers a checkout behind the tip from its merge base, else the nearest kept behind it, else the latest', async () => {
    const { dir, commits } = await repositoryOf(3);
    const config = { project: 'web', report: join(home, 'report.json'), share: { kind: 'git', mainlines: ['main'] } } as Config;
    const first = await publishRun(config, await reportAt(commits[0]!), { env: PUSH, cwd: dir });
    expect(describePublish(config, first)).toContain(`kept the record at ${commits[0]!} beside the latest.`);
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

  it('walks back to a record kept by a sparse mainline, whatever the commits are dated', async () => {
    const dir = await mkdtemp(join(home, 'sparse-'));
    await git(dir, 'init', '--quiet', '-b', 'main');
    const stream = Array.from({ length: 300 }, (_, index) => [
      'commit refs/heads/main',
      `mark :${String(index + 1)}`,
      `committer Test <test@example.com> ${String(1000 - index)} +0000`,
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

  it('walks to a record kept behind the merge base past one kept ahead of it', async () => {
    const dir = await mkdtemp(join(home, 'ahead-'));
    await git(dir, 'init', '--quiet', '-b', 'main');
    for (let index = 0; index < 4; index += 1) {
      await git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '--allow-empty', '-m', String(index));
    }
    const [tip, base, , behind] = (await git(dir, 'rev-list', 'main')).split('\n');

    const walked: string[] = [];
    for await (const commit of keptBehind(base!, new Set([tip!, behind!]), dir)) walked.push(commit);

    expect(walked).toEqual([behind]);
  });
});

describe('the nearest record holding an entry', () => {
  const MAIN = { kind: 'mainline', name: 'main' } as const;
  const options = { descends: async () => undefined, image: async () => new Uint8Array() };
  const entry = (name: string, commit: string): ShareEntry => ({ name, commit, bytes: new Uint8Array([1]) });

  it('reads no kept commit for an entry the latest lacks, because no job published it', async () => {
    const { dir, commits } = await repositoryOf(2);
    const cell = memoryLineCell();
    await publishLine(cell, MAIN, [entry('report-v1', commits[0]!)], options);
    const listing = vi.spyOn(cell, 'commits');

    const found = await nearestHolding(cell, 'main', commits[1]!, 'suite-v1/unit', dir);

    expect(found).toMatchObject({ miss: { kind: 'absent' }, holds: ['report-v1'] });
    expect(listing).not.toHaveBeenCalled();
  });

  it('reads the latest at the merge base when its publish stopped before keeping it by commit', async () => {
    const { dir, commits } = await repositoryOf(2);
    const cell = memoryLineCell();
    await publishLine(cell, MAIN, [entry('report-v1', commits[0]!)], options);
    await publishLine({ ...cell, commits: undefined }, MAIN, [entry('report-v1', commits[1]!)], options);

    const found = await nearestHolding(cell, 'main', commits[1]!, 'report-v1', dir);

    expect(found).toMatchObject({ entry: { commit: commits[1] } });
  });

  it('reads the format asked for behind the merge base when the latest moved to a newer one', async () => {
    const { dir, commits } = await repositoryOf(3);
    const cell = memoryLineCell();
    await publishLine(cell, MAIN, [entry('report-v1', commits[0]!)], options);
    await publishLine(cell, MAIN, [entry('report-v2', commits[2]!)], options);

    const found = await nearestHolding(cell, 'main', commits[1]!, 'report-v1', dir);

    expect(found).toMatchObject({ entry: { commit: commits[0] } });
  });
});

describe('`variance share --purge-older-than`', () => {
  it('takes whole days, and no suite, report or publish beside them', () => {
    expect(parseArgs(['share', '--purge-older-than', '30', '--mainline', 'main'])).toMatchObject({ purgeOlderThan: 30, mainline: 'main' });
    expect(() => parseArgs(['share', '--purge-older-than', 'soon'])).toThrow('whole number of days');
    expect(() => parseArgs(['share', '--purge-older-than', '30', '--suite', 'unit'])).toThrow('whole records');
  });

  it('removes what is kept by commit older than the days named, and leaves the latest', async () => {
    const { dir, commits } = await repositoryOf(2);
    const config = { project: 'web', report: join(home, 'report.json'), share: { kind: 'git', mainlines: ['main'] } } as Config;
    await publishRun(config, await reportAt(commits[0]!), { env: PUSH, cwd: dir });
    await publishRun(config, await reportAt(commits[1]!), { env: PUSH, cwd: dir });
    const refs = (): Promise<string> => git(dir, 'ls-remote', 'origin', 'refs/variance/*');

    expect((await purgeLines(config, 1, undefined, { cwd: dir })).lines).toEqual(['mainline main: removed nothing kept by commit older than 1 day(s).']);
    expect((await refs()).split('\n')).toHaveLength(3);

    const done = await purgeLines(config, 0, 'main', { cwd: dir, now: Date.now() + 1000 * 60 * 60 });

    expect(done.lines).toEqual(['mainline main: removed 2 record(s) kept by commit older than 0 day(s).']);
    expect(await refs()).not.toContain('refs/variance/at/');
    expect(await refs()).toContain('refs/variance/mainline/main');
  });

  it('runs on the share the root config names, and says what it removed', async () => {
    const { dir, commits } = await repositoryOf(1);
    const config = { project: 'web', report: join(home, 'report.json'), share: { kind: 'git', mainlines: ['main'] } } as Config;
    await publishRun(config, await reportAt(commits[0]!), { env: PUSH, cwd: dir });
    await writeFile(join(dir, 'variance.config.json'), JSON.stringify({ share: config.share }));
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    const said: string[] = [];

    const exit = await runSharePurge({ config: 'variance.config.json', purgeOlderThan: 0, mainline: 'main' }, { out: (text) => said.push(text) });

    expect(exit).toBe(EXIT_CLEAN);
    expect(said).toEqual(['mainline main: removed 1 record(s) kept by commit older than 0 day(s).\n']);
    expect(await git(dir, 'ls-remote', 'origin', 'refs/variance/at/*')).toBe('');
  });

  it('runs on the share a named `--config` names, whatever the root config says', async () => {
    const { dir, commits } = await repositoryOf(1);
    const config = { project: 'web', report: join(home, 'report.json'), share: { kind: 'git', mainlines: ['main'] } } as Config;
    await publishRun(config, await reportAt(commits[0]!), { env: PUSH, cwd: dir });
    await writeFile(join(dir, 'variance.config.json'), JSON.stringify({ share: config.share }));
    await git(dir, 'remote', 'add', 'elsewhere', await mkdtemp(join(home, 'elsewhere-')));
    await git(await git(dir, 'remote', 'get-url', 'elsewhere'), 'init', '--bare', '--quiet');
    const named = join(dir, 'alternative.json');
    await writeFile(named, JSON.stringify({
      project: 'web',
      profile: 'chromium',
      viewport: { width: 1280, height: 800 },
      retention: 'ephemeral',
      subjects: { kind: 'list', ids: ['cart/empty'], collector: './collector.mjs' },
      fonts: [],
      report: 'report.json',
      share: { kind: 'git', remote: 'elsewhere', mainlines: ['main'] },
    }));
    vi.spyOn(process, 'cwd').mockReturnValue(dir);

    await runSharePurge({ config: named, configNamed: true, purgeOlderThan: 0, mainline: 'main' }, { out: () => undefined });

    expect(await git(dir, 'ls-remote', 'origin', 'refs/variance/at/*')).toContain(commits[0]!);
  });

  it('says a purge was given `--config` only when it was', () => {
    expect(parseArgs(['share', '--purge-older-than', '7', '--config', 'alternative.json'])).toMatchObject({ configNamed: true });
    expect(parseArgs(['share', '--purge-older-than', '7'])).not.toHaveProperty('configNamed');
  });

  it('refuses a publish that wrote the latest and could not keep it by commit', async () => {
    const { dir, commits } = await repositoryOf(1);
    const config = { project: 'web', report: join(home, 'report.json'), share: { kind: 'git', mainlines: ['main'] } } as Config;
    const hook = join(await git(dir, 'remote', 'get-url', 'origin'), 'hooks', 'update');
    await writeFile(hook, '#!/bin/sh\ncase "$1" in refs/variance/at/*) exit 1;; esac\n');
    await chmod(hook, 0o755);

    const published = shareLines(config, { publish: true, report: await reportAt(commits[0]!) }, { env: PUSH, cwd: dir });

    await expect(published).rejects.toThrow(OperatorError);
    await expect(published).rejects.toThrow(/stopped before it finished keeping records by commit/);
    expect(await git(dir, 'ls-remote', 'origin', 'refs/variance/mainline/main')).toContain('refs/variance/mainline/main');
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
