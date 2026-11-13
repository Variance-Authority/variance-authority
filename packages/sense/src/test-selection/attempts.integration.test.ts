import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RecordedAttempt } from './attempts-record.js';
import { recordedAttemptsAt } from './case-record.js';
import { decodeExecutionIndex } from './execution-format.js';
import type { ExecutionTest } from './reverse.js';

// One file per runner whose first attempts end in every way a body cannot
// tell: stopped by the runner's limit while the body is still running or never
// answers, failed softly, failed through `done`, failed in a hook. Each is
// followed by a second attempt, and the record has to say what the runner said.

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const bin = (path: string): string => resolve(repository, 'node_modules', path);

interface Runner {
  readonly args: (fixture: string) => readonly string[];
  readonly env?: (directory: string) => NodeJS.ProcessEnv;
  /** How each attempt of each retried case ended, by the case's name. */
  readonly ended: Readonly<Record<string, readonly string[]>>;
  /** Whether the runner times each attempt, or only the case. */
  readonly timed: boolean;
}

const stopped = {
  'answers late and then passes': ['failed', 'passed'],
  'never answers and then passes': ['failed', 'passed'],
  'fails twice': ['failed', 'failed'],
};

const runners: Readonly<Record<'vitest' | 'jest' | 'rstest', Runner>> = {
  vitest: {
    args: (fixture) => [bin('vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts')],
    ended: {
      ...stopped,
      'fails softly and then passes': ['failed', 'passed'],
      'hooked > fails in afterEach and then passes': ['failed', 'passed'],
      'fails and then skips': ['failed', 'skipped'],
    },
    timed: true,
  },
  jest: {
    args: (fixture) => [bin('jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'],
    env: (directory) => ({ VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache') }),
    ended: {
      ...stopped,
      'fails through done and then passes': ['failed', 'passed'],
      'hooked fails in afterEach and then passes': ['failed', 'passed'],
    },
    timed: false,
  },
  rstest: {
    args: (fixture) => [bin('@rstest/core/bin/rstest.js'), 'run', '-c', resolve(fixture, 'rstest.config.mjs')],
    ended: stopped,
    timed: false,
  },
};

describe.each(Object.entries(runners))('the attempts %s reports', (runnerName, runner) => {
  const fixture = resolve(repository, 'packages/sense/test/fixtures', `attempts-${runnerName}`);
  let directory: string;
  let tests: readonly ExecutionTest[];
  let attempts: readonly RecordedAttempt[] | undefined;

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), `variance-authority-attempts-${runnerName}-`));
    const coverageFile = resolve(directory, 'coverage.bin');
    // The run fails on purpose: one case fails both of its attempts.
    await execute(process.execPath, runner.args(fixture), {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory, ...runner.env?.(directory) },
    }).catch(() => undefined);
    tests = decodeExecutionIndex(await readFile(coverageFile)).tests;
    attempts = recordedAttemptsAt(coverageFile);
  }, 120_000);

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const rowsOf = (name: string): readonly RecordedAttempt[] => {
    const found = tests.filter((test) => test.name === name);
    expect(found.length, `${name} among ${tests.map((test) => test.name).join(', ')}`).toBeGreaterThan(0);
    return attempts!.filter((row) => found.some((test) => test.id === row.case));
  };

  it('keeps each attempt as the runner ended it, whatever the body did', () => {
    const kept = Object.fromEntries(Object.keys(runner.ended).map((name) => [name, rowsOf(name).map((row) => row.ended)]));
    expect(kept).toEqual(runner.ended);
  });

  it('keeps no row but those: a case that ran once, and a name two declarations share', () => {
    const named = new Set(Object.keys(runner.ended).flatMap((name) => rowsOf(name)));
    expect(attempts!.filter((row) => !named.has(row))).toEqual([]);
    expect(rowsOf('runs once')).toEqual([]);
  });

  it('names what the runner stopped an attempt with', () => {
    const [first, second] = rowsOf('answers late and then passes');
    expect(first!.message).toMatch(/timed? ?out|timeout/iu);
    expect(second!.message).toBeUndefined();
  });

  it('times an attempt only where the runner did', () => {
    for (const row of attempts!) {
      if (runner.timed) expect(Number.isFinite(row.duration) && row.duration! >= 0, `${row.case} ${row.attempt}`).toBe(true);
      else expect(row.duration, `${row.case} ${row.attempt}`).toBeUndefined();
    }
  });
});
