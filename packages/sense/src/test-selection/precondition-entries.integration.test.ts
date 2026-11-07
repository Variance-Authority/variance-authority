import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * An entry in `preconditions` is refused when the runner announces a test run,
 * before any test starts, so each case here runs a real runner. A command that
 * loads the configuration and runs no test is not a run, nor is one with no test
 * file: each exits as it would without the seam, and neither is a project
 * `--project` left out.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/precondition-entries');
const bin = (path: string): string => resolve(repository, 'node_modules', path);
const jest = bin('jest/bin/jest.js');
const vitest = bin('vitest/vitest.mjs');
const rstest = bin('@rstest/core/bin/rstest.js');
const vite = bin('vite/bin/vite.js');

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

const quiet: Readonly<Record<string, readonly string[]>> = {
  'Jest --listTests': [...runs['Jest']!, '--listTests'],
  'Jest --showConfig': [...runs['Jest']!, '--showConfig'],
  'Jest with no test to run': [...runs['Jest']!, '--passWithNoTests', '--testPathPatterns', 'no-such-test'],
  'Vitest with no test to run': [...runs['Vitest']!, '--passWithNoTests', 'no-such-test'],
  'Rstest with no test to run': [...runs['Rstest']!, '--passWithNoTests', 'no-such-test'],
  'Rstest with projects and no test to run': [...refusedAlike['Rstest with projects']!, '--passWithNoTests', 'no-such-test'],
  'vitest list': [vitest, 'list', '--config', resolve(fixture, 'vitest.config.ts')],
  'vitest list that loads each test file': [vitest, 'list', '--no-staticParse', '--config', resolve(fixture, 'vitest.config.ts')],
  'rstest list': [rstest, 'list', '-c', resolve(fixture, 'rstest.config.mjs')],
};

let directory: string;
const ran = (): string => resolve(directory, 'ran');

beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-precondition-entries-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  await rm(resolve(fixture, '.rstest-reports'), { recursive: true, force: true });
});

interface Finished {
  readonly code: number;
  readonly output: string;
}

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
      FIXTURE_TEST_RAN: ran(),
      ...env,
    },
  },
).then(
  ({ stdout, stderr }) => ({ code: 0, output: `${stdout}\n${stderr}` }),
  (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, output: `${error.stdout}\n${error.stderr}` }),
);

describe.each(Object.keys(runs))('a %s run', (runner) => {
  const command = runs[runner]!;

  it('refuses a glob with no test run, and names the path it resolved to', async () => {
    const { code, output } = await finished(command, ['src/**/*.ts']);

    expect(existsSync(ran())).toBe(false);
    expect(code).not.toBe(0);
    expect(output).toContain(`names ${resolve(fixture, 'src/**/*.ts')}, which`);
    expect(output).toContain('Each entry is the path of one file');
    expect(output).not.toContain('could not be read');
  }, 120_000);

  it('refuses a directory with no test run', async () => {
    const { code, output } = await finished(command, ['src']);

    expect(existsSync(ran())).toBe(false);
    expect(code).not.toBe(0);
    expect(output).toContain(`names ${resolve(fixture, 'src')}, which`);
  }, 120_000);

  it('refuses a file a test would write, and says that is not a precondition', async () => {
    const written = resolve(directory, 'generated.json');

    const { code, output } = await finished(command, [written], { FIXTURE_TEST_WRITES: written });

    expect(existsSync(ran())).toBe(false);
    expect(code).not.toBe(0);
    expect(output).toContain('a file a test writes during the run is not a precondition');
  }, 120_000);
});

describe('a file global setup writes', () => {
  it('passes under Jest, which announces the run after that setup', async () => {
    const written = resolve(directory, 'generated.json');

    const { code, output } = await finished(runs['Jest']!, [written], { FIXTURE_SETUP_WRITES: written });

    expect(output).not.toContain('cannot be read as a file');
    expect(code).toBe(0);
    expect(existsSync(ran())).toBe(true);
  }, 120_000);

  it.each(['Vitest', 'Rstest'])('is refused under %s, which announces the run before it', async (runner) => {
    const written = resolve(directory, 'generated.json');

    const { code, output } = await finished(runs[runner]!, [written], { FIXTURE_SETUP_WRITES: written });

    expect(output).toContain('cannot be read as a file');
    expect(code).not.toBe(0);
    expect(existsSync(ran())).toBe(false);
  }, 120_000);
});

describe('a project declares its own entry', () => {
  const projects: Readonly<Record<string, readonly string[]>> = {
    Vitest: refusedAlike['Vitest with projects']!,
    Rstest: refusedAlike['Rstest with projects']!,
  };

  it.each(Object.keys(projects))('%s refuses it when that project runs', async (runner) => {
    const { code, output } = await finished([...projects[runner]!, '--project', 'two'], [], { FIXTURE_PROJECT_PRECONDITIONS: '["src"]' });

    expect(output).toContain(`names ${resolve(fixture, 'src')}, which`);
    expect(code).not.toBe(0);
    expect(existsSync(ran())).toBe(false);
  }, 120_000);

  it.each(Object.keys(projects))('%s reads nothing of a project --project left out', async (runner) => {
    const { code, output } = await finished([...projects[runner]!, '--project', 'one'], [], { FIXTURE_PROJECT_PRECONDITIONS: '["src"]' });

    expect(output).not.toContain('cannot be read as a file');
    expect(code).toBe(0);
    expect(existsSync(ran())).toBe(true);
  }, 120_000);
});

it('a refused Rstest run leaves no seam module behind', async () => {
  await finished(runs['Rstest']!, ['src/**/*.ts']);

  expect(existsSync(resolve(fixture, '.variance-authority'))).toBe(false);
}, 120_000);

it.each(['Jest', 'Vitest'])('a refused %s run that cut a file leaves no cut behind', async (runner) => {
  const { code, output } = await finished(runs[runner]!, ['src/**/*.ts'], {
    FIXTURE_CUT: relative(repository, resolve(fixture, 'test/entries.check.ts')),
  });

  expect(output).toContain('cannot be read as a file');
  expect(code).not.toBe(0);
  expect((await readdir(directory)).filter((name) => name.includes('cut'))).toEqual([]);
}, 120_000);

describe('a run the entry is refused from', () => {
  it.each(Object.keys(refusedAlike))('%s', async (name) => {
    const { code, output } = await finished(refusedAlike[name]!, ['src/**/*.ts']);

    expect(existsSync(ran())).toBe(false);
    expect(code).not.toBe(0);
    expect(output).toContain(`names ${resolve(fixture, 'src/**/*.ts')}, which`);
    expect(output).not.toContain('could not be read');
  }, 120_000);
});

describe('a command that loads the configuration and runs no test', () => {
  it.each(Object.keys(quiet))('%s exits as it would without the seam', async (name) => {
    const { code, output } = await finished(quiet[name]!, ['src/**/*.ts']);

    expect(output).not.toContain('cannot be read as a file');
    expect(code).toBe(0);
    expect(existsSync(ran())).toBe(false);
  }, 120_000);

  it('rstest merge-reports exits as it would without the seam', async () => {
    await finished([...runs['Rstest']!, '--reporter=blob'], []);

    const { code, output } = await finished([rstest, 'merge-reports', '-c', resolve(fixture, 'rstest.config.mjs')], ['src/**/*.ts']);

    expect(output).toContain('Merging 1 blob report');
    expect(output).not.toContain('cannot be read as a file');
    expect(code).toBe(0);
  }, 120_000);

  it('vite build of the shared configuration exits as it would without the seam', async () => {
    const { code, output } = await finished(
      [vite, 'build', '--config', resolve(fixture, 'vitest.config.ts'), '--ssr', 'src/value.ts', '--outDir', resolve(directory, 'built')],
      ['src/**/*.ts'],
    );

    expect(output).not.toContain('cannot be read as a file');
    expect(code).toBe(0);
  }, 120_000);
});
