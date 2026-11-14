/**
 * A cut case names its slowest statement under each runner whose test files
 * are cut: `test/waits.pace.ts` waits 200 ms on line 13 of a case that does
 * nothing else of length.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeExecutionIndex } from './execution-format.js';

const execute = promisify(execFile);
const repository = resolve(import.meta.dirname, '../../../..');
const fixtures = resolve(repository, 'packages/sense/test/fixtures');
const temporary: string[] = [];
const WAIT = { line: 13, time: 200 };

afterAll(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const RSTEST = [
  resolve(repository, 'node_modules/@rstest/core/bin/rstest.js'), 'run',
  '-c', resolve(fixtures, 'external-rstest/rstest.pace.config.mjs'),
];

/** Runs one fixture's waiting case under its runner, and reads the cases it recorded. */
async function recorded(fixture: string, args: readonly string[], env: Record<string, string>) {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-statement-time-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  // A run whose case fails exits non-zero, and still writes its record.
  await execute(process.execPath, args, {
    cwd: resolve(fixtures, fixture),
    env: {
      ...process.env,
      ...env,
      VARIANCE_AUTHORITY_COVERAGE: coverageFile,
      VARIANCE_AUTHORITY_CACHE: directory,
      VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'jest'),
    },
  }).catch(() => undefined);
  return decodeExecutionIndex(await readFile(coverageFile)).tests;
}

const VITEST = [resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.default.config.ts'];
const SCOPED = { FIXTURE_CONTINUATIONS: 'on' };
const JEST = [resolve(repository, 'node_modules/jest/bin/jest.js'), '--config', 'jest.config.mjs', '--watchman=false'];

describe('the slowest statement of a case, under each runner', () => {
  it.each([
    ['Vitest', 'external-vitest', VITEST, { FIXTURE_INCLUDE: 'test/waits.pace.ts' }],
    ['Jest', 'external-jest', JEST, { FIXTURE_TEST_MATCH: '<rootDir>/test/waits.pace.ts' }],
    ['Rstest', 'external-rstest', RSTEST, {}],
  ] as const)('is the line that waited, at no less than its wait and no more than the case, under %s', async (_, fixture, args, env) => {
    const [waits, ...others] = await recorded(fixture, args, env);

    expect(others).toEqual([]);
    expect(waits?.name).toBe('waits on one line');
    expect(waits?.slowest?.line).toBe(WAIT.line);
    expect(waits?.slowest?.time).toBeGreaterThanOrEqual(WAIT.time);
    // The runner's clock spans the whole case; each side rounds to a millisecond.
    expect(waits?.slowest?.time).toBeLessThanOrEqual(waits!.duration! + 1);
  }, 120_000);

  // `test/stops.limit.ts`: the runner stops the first case at 50 ms on line 13,
  // and the second then waits 300 ms on line 17, each in a scope of its own.
  it.each([
    ['Vitest', 'external-vitest', VITEST, { ...SCOPED, FIXTURE_INCLUDE: 'test/stops.limit.ts' }],
    ['Jest', 'external-jest', JEST, { ...SCOPED, FIXTURE_TEST_MATCH: '<rootDir>/test/stops.limit.ts' }],
    ['Rstest', 'external-rstest', RSTEST, { ...SCOPED, FIXTURE_INCLUDE: 'test/stops.limit.ts' }],
  ] as const)('ends where the runner stopped the case, not where its file ended, under %s', async (_, fixture, args, env) => {
    const [stopped, waits, ...others] = await recorded(fixture, args, env);

    expect(others).toEqual([]);
    expect(stopped?.name).toBe('is stopped at its limit');
    expect(stopped?.slowest?.line).toBe(13);
    expect(stopped?.slowest?.time).toBeGreaterThanOrEqual(45);
    expect(stopped?.slowest?.time).toBeLessThan(300);
    expect(waits?.slowest).toMatchObject({ line: 17 });
    expect(waits?.slowest?.time).toBeGreaterThanOrEqual(300);
  }, 120_000);

  it('is not recorded for a case whose file `cadence: false` left uncut', async () => {
    const [waits, ...others] = await recorded('external-rstest', RSTEST, { FIXTURE_CADENCE: 'off' });

    expect(others).toEqual([]);
    expect(waits?.name).toBe('waits on one line');
    expect(waits?.duration).toBeGreaterThanOrEqual(WAIT.time);
    expect(waits?.slowest).toBeUndefined();
  }, 120_000);
});
