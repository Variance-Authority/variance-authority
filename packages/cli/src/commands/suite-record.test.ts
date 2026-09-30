import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, test } from 'vitest';
import { OperatorError } from '../exit.js';
import { parseArgs } from '../parse.js';
import { selectOutput } from './select-command.js';
import { landingRecord, oneRecord, suiteRecord } from './suite-record.js';

async function repository(config?: unknown): Promise<string> {
  const at = await mkdtemp(resolve(tmpdir(), 'va-suite-record-'));
  execFileSync('git', ['init', '--quiet', at]);
  if (config !== undefined) await writeFile(resolve(at, 'variance.config.json'), JSON.stringify(config));

  return at;
}

const TWO = { suites: { unit: { kind: 'unit' }, stories: { kind: 'visual' } } };

describe('the record a one-runner command reads', () => {
  test('is the repository one record when no suite is declared', async () => {
    const at = await suiteRecord(await repository({ project: 'p' }));

    expect(at.endsWith('/coverage.bin')).toBe(true);
    expect(at).not.toContain('/suites/');
  });

  test('is the only declared suite when none is named', async () => {
    const root = await repository({ suites: { stories: { kind: 'visual' } } });

    expect((await suiteRecord(root)).endsWith('/suites/stories/coverage.bin')).toBe(true);
  });

  test('is the named suite when more than one is declared', async () => {
    const root = await repository(TWO);

    expect((await suiteRecord(root, 'unit')).endsWith('/suites/unit/coverage.bin')).toBe(true);
  });

  test('is refused with the suites listed when more than one is declared and none is named', async () => {
    const refused = suiteRecord(await repository(TWO));

    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toThrow(
      'the root variance.config.json declares the suites "stories", "unit", and each records on its own; ' +
        'pass `--suite <name>` to say which record to read',
    );
  });

  test('is refused by name for a suite the root config does not declare', async () => {
    const refused = suiteRecord(await repository(TWO), 'e2e');

    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toThrow('the suite "e2e" is not declared in');
  });
});

describe('the record a one-runner command reads in a worktree that has not run', () => {
  // A relative `cacheRoot` in both checkouts keeps each layer inside its own
  // checkout, whatever cache the suite running this was pointed at.
  async function layered(config: object = {}): Promise<{ primary: string; path: string }> {
    const at = await mkdtemp(resolve(tmpdir(), 'va-suite-record-layers-'));
    const primary = resolve(at, 'primary');
    const gitdir = resolve(primary, '.git', 'worktrees', 'feature');
    await mkdir(gitdir, { recursive: true });
    const path = resolve(at, 'feature');
    await mkdir(path, { recursive: true });
    await writeFile(resolve(path, '.git'), `gitdir: ${gitdir}\n`);
    for (const where of [primary, path]) {
      await writeFile(resolve(where, 'variance.config.json'), JSON.stringify({ cacheRoot: '.cache', ...config }));
    }

    return { primary, path };
  }

  test('is the primary checkout\'s, and a landing still goes to the worktree\'s own layer', async () => {
    const { primary, path } = await layered({ suites: { unit: { kind: 'unit' } } });
    const base = testCoverageFile(primary, { suite: 'unit' });
    await writeTestCoverage(base, { version: 3, instrumentation: 'probe-recipe', tests: [], modules: [] });

    expect(await suiteRecord(path)).toBe(base);
    expect(await landingRecord(path)).toBe(testCoverageFile(path, { suite: 'unit' }));
    expect(await landingRecord(path)).not.toBe(base);
  });

  test('is what `variance select` reads, rather than reporting nothing recorded', async () => {
    const { primary, path } = await layered();
    const base = testCoverageFile(primary);
    await mkdir(dirname(base), { recursive: true });
    await writeFile(base, 'this is not a snapshot');

    // Unreadable on purpose: only a reader that opened the primary checkout's
    // file can refuse it, and one that looked only in the worktree's own layer
    // skips nothing instead.
    await expect(selectOutput({ cwd: path, format: 'plain', noGit: true })).rejects.toThrow(/could not be read/);
  });
});

describe('`--suite` beside a path', () => {
  test('is refused, because both name the record', () => {
    expect(() => oneRecord('unit', '/x/coverage.bin', '--execution')).toThrow(
      '`--suite` and `--execution` both name the record; pass one',
    );
    expect(() => oneRecord('unit', undefined, '--into')).not.toThrow();
    expect(() => parseArgs(['select', '--suite', 'unit', '--execution', 'x'])).toThrow(
      '`--suite` and `--execution` both name the record',
    );
    expect(() => parseArgs(['journeys', 'shard.bin', '--into', 'x', '--suite', 'unit'])).toThrow(
      '`--suite` and `--into` both name the record',
    );
    expect(parseArgs(['run', '--since', 'main', '--suite', 'stories'])).toMatchObject({ suite: 'stories' });
  });
});

describe('`variance select --suite`', () => {
  test('reads the named suite record, and says where it looked', async () => {
    const root = await repository(TWO);
    const said = await selectOutput({ cwd: root, format: 'plain', suite: 'stories', noGit: true });

    expect(said.err).toContain('/suites/stories/coverage.bin');
  });
});
