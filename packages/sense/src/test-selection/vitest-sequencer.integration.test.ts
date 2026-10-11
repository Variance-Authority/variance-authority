import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** The files a run passed, in the order they started; one at a time, so that order is the sequencer's. */
async function started(config: string, ...flags: string[]): Promise<string[]> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-sequencer-'));
  temporary.push(directory);
  const report = resolve(directory, 'report.json');
  await execute(
    process.execPath,
    [vitest, 'run', '--config', resolve(fixture, config), '--no-file-parallelism', '--reporter=json', `--outputFile=${report}`, ...flags],
    { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'), VARIANCE_AUTHORITY_CACHE: directory } },
  );
  const { testResults } = JSON.parse(await readFile(report, 'utf8')) as {
    testResults: { name: string; status: string; startTime: number }[];
  };
  expect(testResults.map((file) => file.status)).toEqual(testResults.map(() => 'passed'));
  return testResults.toSorted((a, b) => a.startTime - b.startTime).map((file) => basename(file.name));
}

describe('the selecting sequencer under `sequence.shuffle`', () => {
  // Two seeds that put these four files in two different orders, so an order
  // that ignores the seed cannot match both.
  it.each([1, 2])('runs the files in the order Vitest\'s own shuffle gives seed %i', async (seed) => {
    const flags = ['--sequence.shuffle', `--sequence.seed=${seed}`];
    const own = await started('vitest.plain.config.ts', ...flags);
    expect(own).not.toEqual(own.toSorted());

    expect(await started('vitest.default.config.ts', ...flags)).toEqual(own);
  }, 60_000);

  it('runs every file when only the tests in each are shuffled', async () => {
    expect((await started('vitest.default.config.ts', '--sequence.shuffle.tests')).toSorted())
      .toEqual(['alpha.case.ts', 'beta.case.ts', 'delta.case.ts', 'gamma.case.ts']);
  }, 60_000);

  // Vitest folds `{ files, tests }` into `shuffle: tests` before any plugin or
  // sequencer sees the command line, so a wrapped run reads `--sequence.shuffle.tests`
  // as `--sequence.shuffle` and `--sequence.shuffle.files` as no shuffle. The
  // configuration file's object is read whole, and is right.
  it.todo('shuffles files under `--sequence.shuffle.files` and not under `--sequence.shuffle.tests`, as Vitest does — needs the command line\'s `sequence.shuffle` object to reach the sequencer');
});
