import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { decodeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../fixture');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
// The Vitest this case installs, not the repository's own: the run under test is Vitest 4's.
const vitest = resolve(here, '../node_modules/vitest/vitest.mjs');

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-4-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** One run of the fixture under Vitest 4: how it exited, what it printed, and which test files it recorded. */
async function launch(name: string, env: Record<string, string>, args: readonly string[]) {
  const coverageFile = resolve(directory, `${name}.bin`);
  // A selection the run of this test was handed is not the fixture's.
  const { VARIANCE_AUTHORITY_SINCE: _since, VARIANCE_AUTHORITY_AT_DISTANCE: _distance, ...inherited } = process.env;
  const finished = await execute(process.execPath, [vitest, 'run', ...args], {
    cwd: fixture,
    env: {
      ...inherited,
      VARIANCE_AUTHORITY_COVERAGE: coverageFile,
      VARIANCE_AUTHORITY_CACHE: resolve(directory, name),
      ...env,
    },
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code?: number; stdout?: string; stderr?: string }) => ({ code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
  );
  const ran = existsSync(coverageFile)
    ? decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file).sort()
    : [];
  return { ...finished, ran };
}

/** The two-file fixture handed `skip`. */
const run = (name: string, skip: readonly string[], ...args: string[]) => launch(name, { FIXTURE_SKIP: JSON.stringify(skip) }, args);

/** The fixture whose configuration describes the run, with no colour for a line to be read through. */
const projects = (name: string, env: Record<string, string>, ...args: string[]) =>
  launch(name, { NO_COLOR: '1', ...env }, ['--config', 'projects.config.ts', ...args]);

describe('a Vitest 4 run handed a selection', () => {
  it('passes, running nothing, when the selection skips every file', async () => {
    const { code, stderr, ran } = await run('none', [at('one.case.ts'), at('two.case.ts')]);

    expect(stderr).toContain('variance-authority: selected none of 2, so none of them runs');
    expect(code).toBe(0);
    expect(ran).toEqual([]);
  }, 60_000);

  it('passes the shard the selection left nothing to run', async () => {
    const { code, stderr } = await run('shard', [at('two.case.ts')], '--shard', '2/2');

    expect(stderr).toContain('variance-authority: selected 1 of 2');
    expect(code).toBe(0);
  }, 60_000);

  it('runs what the selection kept', async () => {
    const { code, ran } = await run('kept', [at('two.case.ts')]);

    expect(code).toBe(0);
    expect(ran).toEqual([at('one.case.ts')]);
  }, 60_000);
});

describe('a Vitest 4 run under --shard', () => {
  it('passes a shard left no file, because there are fewer files than shards', async () => {
    const { code, stderr } = await run('more-shards', [], '--shard', '3/3');

    expect(stderr).toContain('variance-authority: shard 3/3 by file count: 0 of 2 files');
    expect(code).toBe(0);
  }, 60_000);
});

describe('a Vitest 4 run whose configuration describes it', () => {
  const missing = JSON.stringify(['missing.json']);

  it.each([
    ['its own reporters', []],
    ['a reporter of the command line', ['--reporter=dot']],
  ])('refuses what the root declares before any test, under %s', async (name, args) => {
    const { code, stdout, stderr, ran } = await projects(`root-${args.length}`, { FIXTURE_ROOT_PRECONDITIONS: missing }, ...args);

    expect(`${stdout}${stderr}`, name).toContain('which cannot be read as a file');
    expect(stdout).not.toContain('passed');
    expect(code).toBe(1);
    expect(ran).toEqual([]);
  }, 60_000);

  it('refuses what a project declares before any test', async () => {
    const { code, stdout, stderr, ran } = await projects('project', { FIXTURE_PROJECT_PRECONDITIONS: missing });

    expect(`${stdout}${stderr}`).toContain('which cannot be read as a file');
    expect(stdout).not.toContain('passed');
    expect(code).toBe(1);
    expect(ran).toEqual([]);
  }, 60_000);

  it('reads nothing of a project with no test file in the run', async () => {
    const { code, stdout, stderr, ran } = await projects('empty', { FIXTURE_PROJECT_PRECONDITIONS: missing, FIXTURE_TWO_INCLUDE: 'no-such.case.ts' });

    expect(`${stdout}${stderr}`).not.toContain('missing.json');
    expect(code).toBe(0);
    expect(ran).toEqual([at('one.case.ts')]);
  }, 60_000);

  it('refuses what the root declares when one project has a test file and the other none', async () => {
    const { code, stdout, stderr } = await projects('root-empty', { FIXTURE_ROOT_PRECONDITIONS: missing, FIXTURE_TWO_INCLUDE: 'no-such.case.ts' });

    expect(`${stdout}${stderr}`).toContain('which cannot be read as a file');
    expect(stdout).not.toContain('passed');
    expect(code).toBe(1);
  }, 60_000);
});
