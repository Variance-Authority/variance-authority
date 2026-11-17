/**
 * The runs the `jest-selection` cases make: the `external-jest` fixture under a
 * real Jest, handed a selection through the fixture's variables, each run
 * recording into a directory the calling test file owns.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll } from 'vitest';
import { decodeTestCoverage } from '../format.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(here, '../../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-jest');
export const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
export const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
export const FOUND = ['alpha', 'beta', 'delta', 'each', 'gamma'].map((name) => at(`test/${name}.case.ts`));
export const UNFOUND = 'variance-authority: Jest left no test file to select from';

/** How a run ended: the exit code, what it printed to stderr, and what it ran. */
export const ended = (running: Promise<{ readonly stderr: string; readonly ran: readonly string[] }>) => running.then(
  ({ stderr, ran }) => ({ code: 0, stderr, ran }),
  ({ code, stderr }: { readonly code: number; readonly stderr: string }) => ({ code, stderr, ran: [] as readonly string[] }),
);

/** Gives the calling test file a directory for its runs' records and caches, and the runs. */
export function jestSelection() {
  let directory = '';
  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-selected-'));
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function runConfig(config: string, name: string, fixtureEnv: Record<string, string>, ...args: string[]) {
    const coverageFile = resolve(directory, `${name}.bin`);
    const { stdout, stderr } = await execute(
      process.execPath,
      [jest, '--config', resolve(fixture, config), '--watchman=false', ...args],
      {
        cwd: fixture,
        env: {
          ...process.env,
          VARIANCE_AUTHORITY_COVERAGE: coverageFile,
          VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'jest-cache'),
          VARIANCE_AUTHORITY_CACHE: resolve(directory, name),
          ...fixtureEnv,
        },
      },
    );
    const ran = existsSync(coverageFile)
      ? [...new Set(decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file))].sort()
      : [];
    return { stdout, stderr, ran };
  }

  const runWith = (name: string, fixtureEnv: Record<string, string>, ...args: string[]) =>
    runConfig('jest.config.mjs', name, fixtureEnv, ...args);

  return {
    /** The file's own directory, made before its first case and removed after its last. */
    directory: (): string => directory,
    runConfig,
    runWith,
    /** One run of the Jest fixture, handed `skip`: what it printed and which test files it recorded. */
    run: (name: string, skip: readonly string[], ...args: string[]) => runWith(name, { FIXTURE_SKIP: JSON.stringify(skip) }, ...args),
    /** One run of the two-project fixture, handed `skip`, with `empty`'s `testMatch` matching nothing. */
    runProjects: (name: string, skip: readonly string[], empty: readonly string[]) =>
      runConfig('jest.projects.config.mjs', name, { FIXTURE_SKIP: JSON.stringify(skip), FIXTURE_EMPTY_PROJECTS: JSON.stringify(empty) }),
  };
}
