import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, expect, it } from 'vitest';
import { decodeExecutionIndex } from './execution-format.js';

// One test file run by two Jest projects, `plain` and `compiled`, recorded
// through the real seam into a directory of its own for each run.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/twin-projects-jest');
const test = 'packages/sense/test/fixtures/twin-projects-jest/test/greet.case.ts';
const directories: string[] = [];

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

/** The case ids one Jest run with `args` recorded. */
async function idsAfter(args: readonly string[]): Promise<readonly string[]> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-projects-'));
  directories.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false', ...args],
    {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: coverageFile,
        VARIANCE_AUTHORITY_CACHE: directory,
        VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache'),
      },
    },
  );
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
