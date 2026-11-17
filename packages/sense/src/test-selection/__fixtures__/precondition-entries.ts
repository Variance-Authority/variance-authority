/**
 * The runs the `precondition-entries` cases make: a real runner over a copy of
 * `test/fixtures/precondition-entries` that belongs to one test file, so files
 * run side by side share no seam module and no blob report. Each configuration
 * finds its root from its own path, and the copy tells git to ignore it.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, stripVTControlCharacters } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(here, '../../../../..');
const original = resolve(repository, 'packages/sense/test/fixtures/precondition-entries');
const bin = (path: string): string => resolve(repository, 'node_modules', path);
export const jest = bin('jest/bin/jest.js');
export const vitest = bin('vitest/vitest.mjs');
export const rstest = bin('@rstest/core/bin/rstest.js');
export const vite = bin('vite/bin/vite.js');
const LEFT_BY_RUNS = new Set(['node_modules', '.variance-authority', '.rstest-reports']);

export interface Finished {
  readonly code: number;
  readonly output: string;
}

/**
 * Copies the fixture for the calling test file, and gives each case a directory
 * of its own for the record, the caches and the mark a test leaves when it ran.
 */
export function preconditionEntries() {
  const copies = resolve(dirname(original), `.precondition-entries-${randomUUID()}`);
  const fixture = resolve(copies, basename(original));
  let directory = '';

  beforeAll(() => {
    mkdirSync(copies);
    writeFileSync(resolve(copies, '.gitignore'), '*\n');
    cpSync(original, fixture, { recursive: true, filter: (path) => !LEFT_BY_RUNS.has(basename(path)) });
  });
  beforeEach(async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'variance-precondition-entries-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    await rm(resolve(fixture, '.rstest-reports'), { recursive: true, force: true });
  });
  afterAll(() => rm(copies, { recursive: true, force: true }));

  const runs: Readonly<Record<string, readonly string[]>> = {
    Jest: [jest, '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'],
    Vitest: [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')],
    Rstest: [rstest, 'run', '-c', resolve(fixture, 'rstest.config.mjs')],
  };
  const refusedAlike: Readonly<Record<string, readonly string[]>> = {
    'Jest with projects': [jest, '--config', resolve(fixture, 'jest.projects.config.mjs'), '--watchman=false'],
    'Vitest under a command-line --reporter': [...runs['Vitest']!, '--reporter=dot'],
    'Vitest with projects': [vitest, 'run', '--config', resolve(fixture, 'vitest.projects.config.ts')],
    'Rstest with projects': [rstest, 'run', '-c', resolve(fixture, 'rstest.projects.config.mjs')],
  };

  const finished = (command: readonly string[], entries: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<Finished> => execute(
    process.execPath,
    [...command],
    {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'),
        VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'jest-cache'),
        VARIANCE_AUTHORITY_CACHE: directory,
        FIXTURE_PRECONDITIONS: JSON.stringify(entries),
        FIXTURE_TEST_RAN: resolve(directory, 'ran'),
        ...env,
      },
    },
  ).then(
    ({ stdout, stderr }) => ({ code: 0, output: stripVTControlCharacters(`${stdout}\n${stderr}`) }),
    (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, output: stripVTControlCharacters(`${error.stdout}\n${error.stderr}`) }),
  );

  return {
    fixture,
    runs,
    refusedAlike,
    finished,
    /** The case's own directory, made before it starts and removed after it ends. */
    directory: (): string => directory,
    /** Where the fixture's test leaves its mark when it ran. */
    ran: (): string => resolve(directory, 'ran'),
    recordOrNone: (): Promise<Buffer | undefined> => readFile(resolve(directory, 'coverage.bin')).catch(() => undefined),
  };
}
