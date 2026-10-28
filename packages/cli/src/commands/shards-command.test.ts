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

  it('plans the soonest count for a budget the setup alone takes, and names the setup, never a file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'va-shards-setup-'));
    await writeTestCoverage(testCoverageFile(root), {
      version: 3,
      instrumentation: 'fixture',
      commit: 'a'.repeat(40),
      tests: ['a', 'b', 'c', 'd'].map((name) => ({ file: `${name}.test.ts`, complete: true, preconditions: [], duration: 60_000 })),
      modules: [],
    });

    const answer = JSON.parse(await shardsOutput({ cwd: root, setup: 20_000, budget: 5_000, format: 'json' }));
    const text = await shardsOutput({ cwd: root, setup: 20_000, budget: 5_000, format: 'text' });

    expect(answer).toMatchObject({ shards: 4, why: 'setup over budget', setup: 20_000, budget: 5_000, wall: 80_000 });
    expect(answer).not.toHaveProperty('slowest');
    expect(text.split('\n')[2]).toBe('The 5.0 s budget is out of reach: each shard spends 20.0 s of setup alone before its first test.');
  });

  it('answers one shard with nothing recorded, and names the flag that sets the count', async () => {
    const root = mkdtempSync(join(tmpdir(), 'va-shards-bare-'));

    expect(await shardsOutput({ cwd: root, setup: 30_000, format: 'text' })).toBe(
      `1 shard: nothing is recorded there (${testCoverageFile(root)}). \`--unrecorded <n>\` sets the count until the suite is recorded.\n`,
    );
    expect(await shardsOutput({ cwd: root, setup: 30_000, unrecorded: 2, format: 'text' }))
      .toBe(`2 shards, as --unrecorded says: nothing is recorded there (${testCoverageFile(root)}).\n`);
  });
});

describe('parsing variance shards', () => {
  it('reads seconds into milliseconds', () => {
    expect(parseArgs(['shards', '--setup', '90', '--budget', '600.5', '--max', '8', '--unrecorded', '0', '--format', 'json']))
      .toEqual({ command: 'shards', setup: 90_000, budget: 600_500, max: 8, unrecorded: 0, format: 'json' });
  });

  it('takes no setup as none given, and refuses only one that is not seconds', () => {
    expect(parseArgs(['shards'])).toEqual({ command: 'shards', format: 'text' });
    expect(() => parseArgs(['shards', '--setup', '1m'])).toThrow(/--setup is .* in seconds, not `1m`/);
  });

  it('takes a budget the setup alone takes, since the answer says why no count meets it', () => {
    expect(parseArgs(['shards', '--setup', '20', '--budget', '5'])).toMatchObject({ setup: 20_000, budget: 5_000 });
    expect(parseArgs(['shards', '--setup', '20', '--budget', '20'])).toMatchObject({ setup: 20_000, budget: 20_000 });
    expect(parseArgs(['shards', '--setup', '20', '--budget', '0'])).toMatchObject({ setup: 20_000, budget: 0 });
    expect(() => parseArgs(['shards', '--setup', '20', '--budget', 'five'])).toThrow(/--budget is .* in seconds, not `five`/);
  });

  it('counts a change with or without the files the runner collects', () => {
    expect(parseArgs(['shards', '--setup', '1', '--since', 'origin/main'])).toMatchObject({ since: 'origin/main' });
    expect(parseArgs(['shards', '--setup', '1', '--since', 'origin/main', '--collected', 'files.txt']))
      .toMatchObject({ since: 'origin/main', collected: 'files.txt' });
  });

  it('takes --at-distance without --since, which the answer says cuts nothing', () => {
    expect(parseArgs(['shards', '--setup', '1', '--at-distance', '0-2'])).toMatchObject({ atDistance: { from: 0, to: 2 } });
  });

  it('takes no --config, because it reads a record and no project', () => {
    expect(() => parseArgs(['shards', '--setup', '1', '--config', 'x.json'])).toThrow(/--config/);
  });
});
