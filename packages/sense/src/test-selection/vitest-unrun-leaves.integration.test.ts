import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const ext = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A recording of the fixture under one of its configurations and a command line. */
async function recording(config: string, flags: readonly string[]) {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [vitest, 'run', ...flags, '--config', resolve(fixture, config)], {
    cwd: fixture,
    env: {
      ...process.env,
      VARIANCE_AUTHORITY_COVERAGE: coverageFile,
      XDG_CACHE_HOME: directory,
      CUT_STARTED: resolve(directory, 'started'),
    },
  }).catch((error: unknown) => {
    // A cancelled run exits with the failure it cancelled on; what is read
    // here is the recording it left.
    if (!flags.includes('--bail')) throw error;
  });
  return decodeTestCoverage(await readFile(coverageFile));
}

/** Each recorded file, and whether it was recorded whole. */
async function record(
  flags: readonly string[],
  config = 'vitest.unrun.config.ts',
): Promise<readonly (readonly [string, boolean])[]> {
  const coverage = await recording(config, flags);
  return coverage.tests.map((test) => [test.file, test.complete] as const);
}

describe('a file whose runnable tests all passed beside a test the runner never started', () => {
  // A todo, and a test behind a closed `describe.skip` gate. Vitest 2 returns
  // from such a test before it writes any result, so the tree it hands over
  // holds a mode and no state. Read as a test that went missing, a file with one
  // todo was never whole: its held cases were never retired, and every later
  // run was laid over the crossings of modules it no longer reached.
  it('is recorded whole from the tree the reporter is handed', async () => {
    expect(await record([])).toEqual([
      [ext('test/gated.only.ts'), true],
      [ext('test/todo.only.ts'), true],
    ]);
  }, 20_000);

  it('is recorded whole from the tree a worker writes when `--reporter` replaced the reporter', async () => {
    expect(await record(['--reporter', 'dot'])).toEqual([
      [ext('test/gated.only.ts'), true],
      [ext('test/todo.only.ts'), true],
    ]);
  }, 20_000);
});

describe('a file the runner cut on its own', () => {
  // A name filter and a cancel both write `skip` into the mode of a test the
  // file never asked to skip. Recorded whole, such a file's reach shrinks to
  // what the tests that did run reached, and a later change to a region only
  // the others enter no longer selects it — nothing runs it to put that back.
  const filtered = ['-t', 'takes the alpha path', 'test/filtered.cut.ts'];
  const cancelled = ['--bail', '1', 'test/bails.cut.ts', 'test/cancelled.cut.ts'];
  const cut = (flags: readonly string[]) => record(flags, 'vitest.cut.config.ts');

  it('is recorded whole when nothing filtered it, so the filter is what refuses it', async () => {
    expect(await cut(['test/filtered.cut.ts'])).toEqual([[ext('test/filtered.cut.ts'), true]]);
  }, 20_000);

  it('is not recorded whole under a name filter', async () => {
    expect(await cut(filtered)).toEqual([[ext('test/filtered.cut.ts'), false]]);
    expect(await cut(['--reporter', 'dot', ...filtered])).toEqual([[ext('test/filtered.cut.ts'), false]]);
  }, 20_000);

  it('is not recorded whole when the run was cancelled part-way through it', async () => {
    const expected = [[ext('test/bails.cut.ts'), false], [ext('test/cancelled.cut.ts'), false]];
    expect(await cut(cancelled)).toEqual(expected);
    expect(await cut(['--reporter', 'dot', ...cancelled])).toEqual(expected);
  }, 20_000);

  it('was cut between its two tests, so the cancel is what refuses it', async () => {
    // The first test ran and entered `alpha`'s branch; the cancel cut the
    // second, and with it the only test that reaches `gamma`'s.
    const coverage = await recording('vitest.cut.config.ts', ['--reporter', 'dot', ...cancelled]);
    const decide = coverage.modules.find((module) => module.file.endsWith('src/decide.ts'));
    const reached = (path: string) => decide?.blocks.find((block) => block.path === path)?.testFiles;
    expect(reached('if#0/then')).toContain(ext('test/cancelled.cut.ts'));
    expect(reached('if#1/then')).toEqual([]);
  }, 20_000);
});
