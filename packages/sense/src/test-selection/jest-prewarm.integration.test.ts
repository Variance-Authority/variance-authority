import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-jest');
const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
// The fixture's sources, every one of which the record holds: two a case requires, one its setup does.
const RECORDED = /\/src\/[^/]+\.ts$/;
const WARMED = 'variance-authority: transformed';

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-prewarm-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/**
 * One run of the lazy fixture on a cache of its own, recording to `record`:
 * what it printed, and which of the recorded files were transformed in a
 * process that ran a test.
 */
async function run(name: string, record: string, fixtureEnv: Record<string, string>) {
  const log = resolve(directory, `${name}.transforms`);
  const pids = resolve(directory, `${name}.pids`);
  await writeFile(log, '');
  await writeFile(pids, '');
  const { stderr } = await execute(
    process.execPath,
    [jest, '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false', '--maxWorkers=2'],
    {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: resolve(directory, record),
        VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, `${name}-jest-cache`),
        VARIANCE_AUTHORITY_CACHE: resolve(directory, name),
        FIXTURE_TEST_MATCH: '<rootDir>/test/*.lazy.cjs',
        FIXTURE_TRANSFORM_LOG: log,
        FIXTURE_TEST_PIDS: pids,
        ...fixtureEnv,
      },
    },
  );
  const testing = new Set((await readFile(pids, 'utf8')).split('\n').filter(Boolean));
  const inTests = (await readFile(log, 'utf8')).split('\n').filter(Boolean)
    .map((line) => line.split(' '))
    .filter(([pid, path]) => testing.has(pid!) && RECORDED.test(path!))
    .map(([, path]) => path!.replace(/^.*\/src\//, 'src/'));
  return { stderr, inTests: [...new Set(inTests)].sort() };
}

describe('a selected Jest run whose tests require lazily', () => {
  it('transforms the files the record says they load before the workers start, so no test worker transforms one', async () => {
    await run('recorded', 'lazy.bin', {});

    const { stderr, inTests } = await run('selected', 'lazy.bin', { FIXTURE_SKIP: '[]' });

    expect(inTests).toEqual([]);
    expect(stderr).toContain(`${WARMED} 3 files`);
  });

  it('transforms in the tests, as Jest does, when no selection was asked', async () => {
    const { stderr, inTests } = await run('unselected', 'unselected.bin', {});

    expect(stderr).not.toContain(WARMED);
    expect(inTests).toEqual(['src/decide.ts', 'src/later.ts', 'src/sooner.ts']);
  });

  it('transforms in the tests, as Jest does, when the selection has no record to read', async () => {
    const { stderr, inTests } = await run('unrecorded', 'missing.bin', { FIXTURE_SKIP: '[]' });

    expect(stderr).not.toContain(WARMED);
    expect(inTests).toEqual(['src/decide.ts', 'src/later.ts', 'src/sooner.ts']);
  });
});
