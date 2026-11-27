import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readCommitRuns, type CommitRuns } from './commit-runs.js';

// Each runner that says how many workers it ran its files in names them, and
// its landing names the machine with them.

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const bin = (path: string): string => resolve(repository, 'node_modules', path);

const runners: Readonly<Record<'vitest' | 'jest', { readonly args: (fixture: string) => readonly string[]; readonly env?: (directory: string) => NodeJS.ProcessEnv }>> = {
  vitest: { args: (fixture) => [bin('vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts'), '--maxWorkers=2'] },
  jest: {
    args: (fixture) => [bin('jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false', '--maxWorkers=2'],
    env: (directory) => ({ VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache') }),
  },
};

describe.each(Object.entries(runners))('the machine a %s run names', (runnerName, runner) => {
  const fixture = resolve(repository, 'packages/sense/test/fixtures', `attempts-${runnerName}`);
  let directory: string;
  let runs: CommitRuns | undefined;

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), `variance-authority-machine-${runnerName}-`));
    const coverageFile = resolve(directory, 'coverage.bin');
    // The run fails on purpose: one case of the fixture fails both of its attempts.
    await execute(process.execPath, runner.args(fixture), {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory, ...runner.env?.(directory) },
    }).catch(() => undefined);
    runs = await readCommitRuns(coverageFile);
  }, 120_000);

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('names the machine with the workers the runner ran in, and no host', () => {
    const machines = runs?.landings.map((landing) => landing.machine);

    expect(machines).toEqual([expect.objectContaining({ arch: process.arch, node: process.version, workers: 2 })]);
    expect(JSON.stringify(machines)).not.toContain(`"${hostname()}"`);
  });
});
