import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { parseArgs } from '../bin.js';
import { shardsOutput } from './shards-command.js';

describe('variance shards', () => {
  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-shards-cache-'));
  });

  afterEach(() => {
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('counts the shards from the record every shard places its files by', async () => {
    const root = mkdtempSync(join(tmpdir(), 'va-shards-'));
    await writeTestCoverage(testCoverageFile(root), {
      version: 3,
      instrumentation: 'fixture',
      commit: 'a'.repeat(40),
      tests: ['a', 'b', 'c', 'd'].map((name) => ({ file: `${name}.test.ts`, complete: true, preconditions: [], duration: 60_000 })),
      modules: [],
    });

    const answer = JSON.parse(await shardsOutput({ cwd: root, setup: 10_000, format: 'json' }));

    expect(answer).toMatchObject({ shards: 4, matrix: ['1/4', '2/4', '3/4', '4/4'], why: 'slowest group', wall: 70_000 });
  });

  it('refuses to count with nothing recorded, and names the flag that answers anyway', async () => {
    const root = mkdtempSync(join(tmpdir(), 'va-shards-bare-'));

    await expect(shardsOutput({ cwd: root, setup: 30_000, format: 'text' })).rejects.toThrow(/--unrecorded <n>/);
    expect(await shardsOutput({ cwd: root, setup: 30_000, unrecorded: 2, format: 'text' }))
      .toBe(`2 shards, as --unrecorded says: nothing is recorded there (${testCoverageFile(root)}).\n`);
  });
});

describe('parsing variance shards', () => {
  it('reads seconds into milliseconds', () => {
    expect(parseArgs(['shards', '--setup', '90', '--budget', '600.5', '--max', '8', '--unrecorded', '0', '--format', 'json']))
      .toEqual({ command: 'shards', setup: 90_000, budget: 600_500, max: 8, unrecorded: 0, format: 'json' });
  });

  it('has no default setup, because it is one CI pipeline and not another', () => {
    expect(() => parseArgs(['shards'])).toThrow(/needs `--setup <seconds>`/);
    expect(() => parseArgs(['shards', '--setup', '1m'])).toThrow(/--setup is .* in seconds, not `1m`/);
  });

  it('counts a change only against the files the runner collects', () => {
    expect(() => parseArgs(['shards', '--setup', '1', '--since', 'origin/main'])).toThrow(/--since` needs `--collected <file>`/);
    expect(parseArgs(['shards', '--setup', '1', '--since', 'origin/main', '--collected', 'files.txt']))
      .toMatchObject({ since: 'origin/main', collected: 'files.txt' });
  });

  it('takes no --config, because it reads a record and no project', () => {
    expect(() => parseArgs(['shards', '--setup', '1', '--config', 'x.json'])).toThrow(/--config/);
  });
});
