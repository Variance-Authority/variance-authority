import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
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

/** The wrap's refusal of the fixture's preset, having looked from `from`. */
const refusal = (from: string): RegExp => new RegExp(`preset \\./preset\\.cjs cannot be read as Jest will read it: .*${from} .*absolute path`, 'u');

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
      stderr: expect.stringMatching(refusal(dirname(fixture))),
    });
    await expect(run).rejects.not.toMatchObject({ stderr: expect.stringContaining('Test Suites:') });
  });
}, 60_000);

it('names a preset a sibling directory also holds, under a relative `rootDir`, and runs no transformer of that other preset', async () => {
  await inDirectory(async (directory) => {
    const ran = resolve(directory, 'wrong-preset-ran');
    await writeFile(resolve(directory, 'package.json'), '{"name":"sibling","private":true}\n');
    await symlink(resolve(root, 'node_modules'), resolve(directory, 'node_modules'));
    await writeFile(resolve(directory, 'preset.cjs'), 'module.exports = { transform: { "\\\\.ts$": "<rootDir>/wrong.cjs" } };\n');
    await writeFile(resolve(directory, 'wrong.cjs'), [
      `require('node:fs').writeFileSync(${JSON.stringify(ran)}, '');`,
      'module.exports = { process: (source) => ({ code: source.replace(/: number/g, "") }) };\n',
    ].join('\n'));
    const run = jest(directory, directory, { FIXTURE_ROOT_DIR: '.' });
    await expect(run).rejects.toMatchObject({ stderr: expect.stringMatching(refusal(await realpath(directory))) });
    await expect(run).rejects.not.toMatchObject({ stderr: expect.stringContaining('Test Suites:') });
    await expect(access(ran)).rejects.toMatchObject({ code: 'ENOENT' });
  });
}, 60_000);

it('sends a run whose test file fails to compile to the failure, and to no setting Jest does not have', async () => {
  await inDirectory(async (directory) => {
    const { stderr } = await jest(directory, fixture, { FIXTURE_TRANSFORM: '{"\\\\.ts$":"<rootDir>/fails-to-compile.cjs"}' }).then(
      () => { throw new Error('the run passed'); },
      (failed: { stderr: string }) => failed,
    );
    const note = stderr.split('\n').find((line) => line.includes('instrumented 0 modules across 1 test file(s)'));
    expect(note).toContain('read the failures above');
    expect(note).not.toMatch(/`include`|plugin/u);
  });
}, 60_000);
