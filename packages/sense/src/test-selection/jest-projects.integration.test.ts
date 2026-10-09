import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeExecutionIndex } from './execution-format.js';
import { readTestCoverage } from './index.js';

// One test file run by two Jest projects, recorded through the real seam into
// a directory of its own for each run.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const directories: string[] = [];

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

/** The record one Jest run of `fixture` with `args` wrote. */
async function recordAfter(fixture: string, args: readonly string[]): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-projects-'));
  directories.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  const root = resolve(repository, 'packages/sense/test/fixtures', fixture);
  await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/jest/bin/jest.js'), '--config', resolve(root, 'jest.config.mjs'), '--watchman=false', ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: coverageFile,
        VARIANCE_AUTHORITY_CACHE: directory,
        VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache'),
      },
    },
  );
  return coverageFile;
}

describe('a case two Jest projects run', () => {
  const test = 'packages/sense/test/fixtures/twin-projects-jest/test/greet.case.ts';

  /** The case ids one Jest run with `args` recorded. */
  async function idsAfter(args: readonly string[]): Promise<readonly string[]> {
    const coverageFile = await recordAfter('twin-projects-jest', args);
    return decodeExecutionIndex(await readFile(coverageFile)).tests.map((recorded) => recorded.id).sort();
  }

  it('tells the copies of a case apart by the project that ran each', async () => {
    expect(await idsAfter([])).toEqual([
      `|compiled| ${test} > greets by name`,
      `|plain| ${test} > greets by name`,
    ]);
  }, 120_000);

  it('names a case the same whether the run took every project or one', async () => {
    expect(await idsAfter(['--selectProjects', 'compiled'])).toEqual([`|compiled| ${test} > greets by name`]);
  }, 120_000);
});

describe('a file one Jest project skips whole', () => {
  const test = 'packages/sense/test/fixtures/half-skipped-jest/test/greet.case.ts';

  /** Whether the run with `args` recorded the test file whole. */
  async function completeAfter(args: readonly string[]): Promise<boolean | undefined> {
    const coverage = await readTestCoverage(await recordAfter('half-skipped-jest', args));
    return coverage.tests.find((recorded) => recorded.file === test)?.complete;
  }

  it('is partial, though the other project left a journal for the same path', async () => {
    expect(await completeAfter([])).toBe(false);
  }, 120_000);

  it('is whole where only the project that ran it ran', async () => {
    expect(await completeAfter(['--selectProjects', 'runs'])).toBe(true);
  }, 120_000);
});
