import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, stripVTControlCharacters } from 'node:util';
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
  const directory = await scratch();
  const report = resolve(directory, 'report.json');
  await run(directory, config, '--reporter=json', `--outputFile=${report}`, ...flags);
  const { testResults } = JSON.parse(await readFile(report, 'utf8')) as Report;
  expect(testResults.map((file) => file.status)).toEqual(testResults.map(() => 'passed'));
  return testResults.toSorted((a, b) => a.startTime - b.startTime).map((file) => basename(file.name));
}

/** What a run wrote to stdout, one file at a time, under the reporters `flags` leave it, as a terminal shows it: Vitest colours it wherever `CI` or `FORCE_COLOR` is set. */
async function run(directory: string, config: string, ...flags: string[]): Promise<string> {
  const { stdout } = await execute(
    process.execPath,
    [vitest, 'run', '--config', resolve(fixture, config), '--no-file-parallelism', ...flags],
    { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'), VARIANCE_AUTHORITY_CACHE: directory } },
  );
  return stripVTControlCharacters(stdout);
}

async function scratch(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-sequencer-'));
  temporary.push(directory);
  return directory;
}

interface Report {
  readonly testResults: readonly { readonly name: string; readonly status: string; readonly startTime: number }[];
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

  it('names the seed it shuffled with in the banner, where Vitest names its own, and that seed runs the files in the same order', async () => {
    const lines = (await run(await scratch(), 'vitest.default.config.ts', '--sequence.shuffle')).split('\n');
    const banner = lines.findIndex((line) => line.includes(' RUN '));
    const seed = /^ {6}Running tests with seed "(\d+)"$/.exec(lines[banner + 1] ?? '')?.[1];
    expect(seed).toBeDefined();
    // The default reporter names each file as it finishes, and one runs at a time.
    const order = lines.flatMap((line) => /✓ test\/(\S+)/.exec(line)?.[1] ?? []);

    expect(await started('vitest.default.config.ts', '--sequence.shuffle', `--sequence.seed=${seed}`)).toEqual(order);
  }, 60_000);

  // A reporter that prints no banner prints no seed, as Vitest's own do: the
  // JSON reporter with no `outputFile` writes its report to stdout.
  it('leaves stdout to a reporter that prints no banner', async () => {
    const stdout = await run(await scratch(), 'vitest.default.config.ts', '--sequence.shuffle', '--reporter=json');

    expect((JSON.parse(stdout) as Report).testResults).toHaveLength(4);
  }, 60_000);

  it('runs every file when only the tests in each are shuffled', async () => {
    expect((await started('vitest.default.config.ts', '--sequence.shuffle.tests')).toSorted())
      .toEqual(['alpha.case.ts', 'beta.case.ts', 'delta.case.ts', 'gamma.case.ts']);
  }, 60_000);

  // Vitest folds `{ files, tests }` into `shuffle: tests` before any plugin or
  // sequencer sees the command line. From Vitest 3 the sequencer reads the
  // command line as parsed, from `_cliOptions`, which `vitest-sequencer.test.ts`
  // pins in process; Vitest 2, which this repository runs, keeps it to itself, so
  // a wrapped run there reads `--sequence.shuffle.tests` as `--sequence.shuffle`
  // and `--sequence.shuffle.files` as no shuffle. The configuration file's object
  // is read whole, and is right on every version.
  it.todo('shuffles files under `--sequence.shuffle.files` and not under `--sequence.shuffle.tests` on Vitest 2, as Vitest does — needs the command line, which Vitest 2 hands to no plugin or sequencer');
});
