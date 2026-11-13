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

describe('the slowest statement of a case, under each runner', () => {
  it.each([
    [
      'Vitest',
      'external-vitest',
      [resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.default.config.ts'],
      { FIXTURE_INCLUDE: 'test/waits.pace.ts' },
    ],
    [
      'Jest',
      'external-jest',
      [resolve(repository, 'node_modules/jest/bin/jest.js'), '--config', 'jest.config.mjs', '--watchman=false'],
      { FIXTURE_TEST_MATCH: '<rootDir>/test/waits.pace.ts' },
    ],
    [
      'Rstest',
      'external-rstest',
      [
        resolve(repository, 'node_modules/@rstest/core/bin/rstest.js'), 'run',
        '-c', resolve(fixtures, 'external-rstest/rstest.pace.config.mjs'),
      ],
      {},
    ],
  ] as const)('is the line that waited, at no less than its wait and no more than the case, under %s', async (_, fixture, args, env) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-statement-time-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    await execute(process.execPath, args, {
      cwd: resolve(fixtures, fixture),
      env: {
        ...process.env,
        ...env,
        VARIANCE_AUTHORITY_COVERAGE: coverageFile,
        VARIANCE_AUTHORITY_CACHE: directory,
        VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'jest'),
      },
    });

    const [waits, ...others] = decodeExecutionIndex(await readFile(coverageFile)).tests;

    expect(others).toEqual([]);
    expect(waits?.name).toBe('waits on one line');
    expect(waits?.slowest?.line).toBe(WAIT.line);
    expect(waits?.slowest?.time).toBeGreaterThanOrEqual(WAIT.time);
    // The runner's clock spans the whole case; each side rounds to a millisecond.
    expect(waits?.slowest?.time).toBeLessThanOrEqual(waits!.duration! + 1);
  }, 120_000);
});
