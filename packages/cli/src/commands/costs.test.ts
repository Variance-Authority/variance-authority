import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import type { Env } from '../share-lines.js';
import { costsEntryOf } from './costs-entry.js';
import { costsOf, mainlineCosts, publishedCostsLine } from './costs.js';
import { shardOwnedBecause, type CliRunReport } from './run-report.js';
import { publishRun } from './share.js';

/**
 * Subject costs, from the report that timed them to the run that balances on
 * them. The round trip is the claim: a report's costs, published to the
 * mainline beside its suite index, are what the next build's shards read.
 */

const run = promisify(execFile);
const PUSH: Env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };
const LOCAL: Env = {};

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-costs-'));
  process.env['XDG_CACHE_HOME'] = join(home, 'cache');
});

afterEach(async () => {
  delete process.env['XDG_CACHE_HOME'];
  await rm(home, { recursive: true, force: true });
});

function configOf(share: { root?: string } = {}): Config {
  return {
    project: 'web',
    report: join(home, 'report.json'),
    ...(share.root === undefined ? {} : { share: { kind: 'directory', root: share.root, mainlines: ['main'] } }),
  } as Config;
}

function reportOf(commit: string | undefined, over: Partial<CliRunReport> = {}): CliRunReport {
  return {
    runVersion: 1,
    at: '2026-09-27T10:00:00.000Z',
    retention: 'durable',
    ...(commit === undefined ? {} : { run: { id: 'build-1', commit } }),
    observations: [
      { subject: 'story:b', verdict: 'unchanged', because: 'nothing moved', regions: [], costMs: 120.4 },
      { subject: 'story:a', verdict: 'unchanged', because: 'nothing moved', regions: [], costMs: 80.6 },
      { subject: 'story:c', verdict: 'unchanged', because: 'nothing moved', regions: [] },
    ],
    notObserved: [],
    composition: { subjects: ['story:a', 'story:b', 'story:c'], components: [] },
    ...over,
  } as CliRunReport;
}

async function reportAt(commit: string): Promise<string> {
  const path = join(home, `run-${commit}.json`);
  await writeFile(path, JSON.stringify(reportOf(commit)));
  return path;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

async function repository(): Promise<{ dir: string; head: string }> {
  const dir = await mkdtemp(join(home, 'repo-'));
  const origin = await mkdtemp(join(home, 'origin-'));
  await git(origin, 'init', '--bare', '--quiet');
  await git(dir, 'init', '--quiet', '-b', 'main');
  await git(dir, 'config', 'user.email', 'test@example.com');
  await git(dir, 'config', 'user.name', 'Test');
  await git(dir, 'remote', 'add', 'origin', origin);
  await git(dir, 'commit', '--quiet', '--allow-empty', '-m', 'one');
  await git(dir, 'push', '--quiet', 'origin', 'main');
  await git(dir, 'fetch', '--quiet', 'origin');
  return { dir, head: await git(dir, 'rev-parse', 'HEAD') };
}

describe('subject costs', () => {
  it('are the timed subjects, rounded, and nothing for a subject that was not timed', () => {
    expect([...costsOf(reportOf('3f1c'))]).toEqual([
      ['story:b', 120],
      ['story:a', 81],
    ]);
  });

  it('round-trip from a published report to the next run on that lineage', async () => {
    const { dir, head } = await repository();
    const root = join(home, 'share');
    const config = configOf({ root });

    const done = await publishRun(config, await reportAt(head), { env: PUSH, cwd: dir });
    expect(done).toMatchObject({ published: { written: ['suite-index-v1', 'subject-costs-v1'] } });
    expect(await readdir(root)).not.toEqual([]);

    const found = await mainlineCosts(config, { env: LOCAL, cwd: dir });
    expect(found?.commit).toBe(head);
    expect(found?.distance).toBe(0);
    expect(Object.fromEntries(found?.costs ?? [])).toEqual({ 'story:a': 81, 'story:b': 120 });
  });

  it('come from the share on a machine that holds none, and are kept for the next command', async () => {
    const { dir, head } = await repository();
    const root = join(home, 'share');
    await publishRun(configOf({ root }), await reportAt(head), { env: PUSH, cwd: dir });

    process.env['XDG_CACHE_HOME'] = await mkdtemp(join(home, 'cold-'));
    const found = await mainlineCosts(configOf({ root }), { env: LOCAL, cwd: dir });
    expect(Object.fromEntries(found?.costs ?? [])).toEqual({ 'story:a': 81, 'story:b': 120 });
  });

  it('are not found where the lineage has none', async () => {
    const { dir } = await repository();
    expect(await mainlineCosts(configOf({ root: join(home, 'share') }), { env: LOCAL, cwd: dir })).toBeNull();
  });

  it('are refused from a report with no commit, from one shard, and from a run that timed nothing', async () => {
    const config = configOf();
    const shard = reportOf('3f1c', {
      notObserved: [{ subject: 'story:z', kind: 'excluded', because: shardOwnedBecause(2, 2, 'checksum') }],
    });
    const untimed = reportOf('3f1c', {
      observations: [{ subject: 'story:c', verdict: 'unchanged', because: 'nothing moved', regions: [] }],
    });

    const at = { commit: '3f1c' };
    expect(await costsEntryOf(config, reportOf(undefined), at)).toEqual({ none: 'this report names no commit' });
    expect(await costsEntryOf(config, shard, at)).toEqual({ none: 'this report is one shard; publish the shards together' });
    expect(await costsEntryOf(config, untimed, at)).toEqual({ none: 'this report timed no subject' });
    expect(await costsEntryOf(config, reportOf('3f1c'), at)).toMatchObject({ name: 'subject-costs-v1', commit: '3f1c' });
  });

  it('say where a run kept them, and a run says nothing when there is nothing', async () => {
    const config = configOf({ root: join(home, 'share') });

    expect(await publishedCostsLine(config, reportOf('3f1c'))).toMatch(/^subject costs: .*3f1c\.costs\.json\n$/);
    expect(await publishedCostsLine(config, reportOf(undefined))).toBe('');
  });
});
