import { execFile } from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { costsLine, costsOf, mainlineCosts, publishCosts, publishedCostsLine } from './costs.js';
import { shardOwnedBecause, type CliRunReport } from './run-report.js';

/**
 * Subject costs, from the report that timed them to the run that balances on
 * them. The round trip is the claim: a merged report's costs, published under
 * its commit, are what the next build's shards read from the merge base.
 */

const git = promisify(execFile);

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-costs-'));
  process.env['XDG_CACHE_HOME'] = home;
});

afterEach(() => {
  delete process.env['XDG_CACHE_HOME'];
});

function configOf(share: { root?: string } = {}): Config {
  return {
    project: 'web',
    report: join(home, 'report.json'),
    ...(share.root === undefined ? {} : { share: { kind: 'directory', root: share.root } }),
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
    ...over,
  } as CliRunReport;
}

async function repository(): Promise<{ dir: string; head: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'variance-costs-repo-'));
  await git('git', ['init', '--quiet'], { cwd: dir });
  await git('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await git('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await git('git', ['commit', '--quiet', '--allow-empty', '-m', 'one'], { cwd: dir });
  const { stdout } = await git('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return { dir, head: stdout.trim() };
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

    expect(await publishCosts(config, reportOf(head))).toEqual({ commit: head, subjects: 2 });
    expect(await readdir(join(root, 'web', 'subject-costs-v1'))).toEqual([`${head}.bin`]);

    const found = await mainlineCosts(config, { ref: 'HEAD', cwd: dir });
    expect(found?.commit).toBe(head);
    expect(found?.behind).toBe(0);
    expect(Object.fromEntries(found?.costs ?? [])).toEqual({ 'story:a': 81, 'story:b': 120 });
  });

  it('come from the share on a machine that holds none, and are kept for the next command', async () => {
    const { dir, head } = await repository();
    const root = join(home, 'share');
    await publishCosts(configOf({ root }), reportOf(head));

    process.env['XDG_CACHE_HOME'] = await mkdtemp(join(tmpdir(), 'variance-costs-cold-'));
    expect((await mainlineCosts(configOf({ root }), { ref: 'HEAD', cwd: dir }))?.commit).toBe(head);
    // No share now: only the local copy the fetch kept can answer.
    expect((await mainlineCosts(configOf(), { ref: 'HEAD', cwd: dir }))?.commit).toBe(head);
  });

  it('are not found where the lineage has none', async () => {
    const { dir } = await repository();
    expect(await mainlineCosts(configOf(), { ref: 'HEAD', cwd: dir })).toBeNull();
  });

  it('are refused from a report with no commit, from one shard, and from a run that timed nothing', async () => {
    const config = configOf();
    const shard = reportOf('3f1c', {
      notObserved: [{ subject: 'story:z', kind: 'excluded', because: shardOwnedBecause(2, 2, 'checksum') }],
    });
    const untimed = reportOf('3f1c', {
      observations: [{ subject: 'story:c', verdict: 'unchanged', because: 'nothing moved', regions: [] }],
    });

    expect(await publishCosts(config, reportOf(undefined))).toMatch(/names no commit/);
    expect(await publishCosts(config, shard)).toMatch(/is one shard; publish the shards together/);
    expect(await publishCosts(config, untimed)).toMatch(/timed no subject/);
  });

  it('say where they went when shared, and a run says nothing when there is nothing', async () => {
    const config = configOf({ root: join(home, 'share') });

    expect(await costsLine(config, reportOf('3f1c'))).toMatch(
      /^subject costs of 2 subject\(s\): .*3f1c\.costs\.json \(published\)$/,
    );
    expect(await publishedCostsLine(config, reportOf('3f1c'))).toMatch(/^subject costs: .*\(published\)\n$/);
    expect(await publishedCostsLine(config, reportOf(undefined))).toBe('');
  });
});
