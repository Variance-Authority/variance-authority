import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const fixture = resolve(root, 'packages/sense/test/fixtures/jest-preset');

const JEST = resolve(root, 'node_modules/jest/bin/jest.js');

/** Real Jest on the fixture, from `cwd`; its record is read before the directory it sits in goes. */
async function jest(directory: string, cwd: string, env: NodeJS.ProcessEnv): Promise<ReturnType<typeof decodeTestCoverage>> {
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [JEST, '--config', resolve(fixture, 'jest.config.mjs'), '--runInBand', '--watchman=false'], {
    cwd,
    env: { ...process.env, FIXTURE_COVERAGE: coverageFile, FIXTURE_CACHE: resolve(directory, 'cache'), ...env },
  });
  return decodeTestCoverage(await readFile(coverageFile));
}

async function inDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-jest-preset-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

it.each([
  ['names no `transform`', fixture, undefined],
  ['sets `transform: {}`', fixture, '{}'],
  ['names a `transform` for other files', fixture, '{"\\\\.css$":"<rootDir>/strip-types.cjs"}'],
  ['runs from outside the config file\'s directory', dirname(fixture), undefined],
])('compiles on the first run through the preset\'s transformer, and records it, when the object %s', async (_, cwd, transform) => {
  await inDirectory(async (directory) => {
    const record = await jest(directory, cwd, transform === undefined ? {} : { FIXTURE_TRANSFORM: transform });
    expect(record.tests.map((test) => test.complete)).toEqual([true]);
    expect(record.modules.find((module) => module.file === relative(root, resolve(fixture, 'src/add.ts')))?.instrumented).toBe(true);
  });
}, 60_000);

it('names a preset only the config file\'s directory can read, under a relative `rootDir`, before any test runs', async () => {
  await inDirectory(async (directory) => {
    const run = jest(directory, dirname(fixture), { FIXTURE_ROOT_DIR: '.' });
    await expect(run).rejects.toMatchObject({
      stderr: expect.stringMatching(new RegExp(`preset \\./preset\\.cjs is not found from ${dirname(fixture)}\\. .*absolute path`, 'u')),
    });
    await expect(run).rejects.not.toMatchObject({ stderr: expect.stringContaining('Test Suites:') });
  });
}, 60_000);
