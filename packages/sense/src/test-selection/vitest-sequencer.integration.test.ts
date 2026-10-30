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
  return startedWith({}, config, ...flags);
}

/** {@link started}, with `env` over the fixture's. */
async function startedWith(env: Record<string, string>, config: string, ...flags: string[]): Promise<string[]> {
  const directory = await scratch();
  const report = resolve(directory, 'report.json');
  await output(directory, env, config, '--reporter=json', `--outputFile=${report}`, ...flags);
  const { testResults } = JSON.parse(await readFile(report, 'utf8')) as Report;
  expect(testResults.map((file) => file.status)).toEqual(testResults.map(() => 'passed'));
  return testResults.toSorted((a, b) => a.startTime - b.startTime).map((file) => basename(file.name));
}

/** What a run wrote to stdout, one file at a time, under the reporters `flags` leave it, as a terminal shows it: Vitest colours it wherever `CI` or `FORCE_COLOR` is set. */
async function run(directory: string, config: string, ...flags: string[]): Promise<string> {
  return (await output(directory, {}, config, ...flags)).stdout;
}

/** What a run wrote to stdout and to stderr, as {@link run} reads them, with `env` over the fixture's. */
async function output(directory: string, env: Record<string, string>, config: string, ...flags: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execute(
    process.execPath,
    [vitest, 'run', '--config', resolve(fixture, config), '--no-file-parallelism', ...flags],
    { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'), VARIANCE_AUTHORITY_CACHE: directory, ...env } },
  );
  return { stdout: stripVTControlCharacters(stdout), stderr: stripVTControlCharacters(stderr) };
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

  // A reporter named on the command line replaces the configured ones, the
  // seam's among them. From Vitest 3.1 a plugin reaches the banner as well, so
  // the seed is named there, where Vitest names its own, and not again on stderr.
  it('names the seed it shuffled with under a reporter named on the command line, and that seed runs the files in the same order', async () => {
    const { stdout, stderr } = await output(await scratch(), {}, 'vitest.default.config.ts', '--sequence.shuffle', '--reporter=default');
    const seed = /^ {6}Running tests with seed "(\d+)"$/m.exec(stdout)?.[1];
    expect(seed).toBeDefined();
    expect(stderr).not.toContain('running tests with seed');
    const order = stdout.split('\n').flatMap((line) => /✓ test\/(\S+)/.exec(line)?.[1] ?? []);

    expect(await started('vitest.default.config.ts', '--sequence.shuffle', `--sequence.seed=${seed}`)).toEqual(order);
  }, 60_000);

  // Selection removes files before Vitest orders them, so a shuffled selected
  // run is the run Vitest gives the files it kept, with the same seed.
  it.each([1, 2, 3])('runs the files a selection keeps in the order Vitest gives those files alone with seed %i', async (seed) => {
    const flags = ['--sequence.shuffle', `--sequence.seed=${seed}`];
    const own = await started('vitest.plain.config.ts', ...flags, 'test/alpha', 'test/beta', 'test/delta');
    expect(own.toSorted()).toEqual(['alpha.case.ts', 'beta.case.ts', 'delta.case.ts']);

    expect(await startedWith({ FIXTURE_SKIP: JSON.stringify(['packages/sense/test/fixtures/external-vitest/test/gamma.case.ts']) }, 'vitest.default.config.ts', ...flags)).toEqual(own);
  }, 60_000);

  // A reporter that prints no banner prints no seed, as Vitest's own do.
  it('leaves stdout to a reporter that prints no banner', async () => {
    const directory = await scratch();
    const report = resolve(directory, 'report.json');
    const stdout = await run(directory, 'vitest.default.config.ts', '--sequence.shuffle', '--reporter=json', `--outputFile=${report}`);

    expect(stdout).not.toContain('seed');
    expect((JSON.parse(await readFile(report, 'utf8')) as Report).testResults).toHaveLength(4);
  }, 60_000);

  // Vitest folds `{ files, tests }` into `shuffle: tests` once it has picked
  // its sequencer, so the resolved config reads `--sequence.shuffle.tests` as
  // `--sequence.shuffle` and `--sequence.shuffle.files` as no shuffle. Without
  // the cache, the files Vitest leaves unshuffled run largest first, which no
  // shuffle by seed 1 gives these four.
  it.each(['files', 'tests'])('orders the files as Vitest does under `--sequence.shuffle.%s`', async (part) => {
    const flags = [`--sequence.shuffle.${part}`, '--sequence.seed=1', '--no-cache'];
    const own = await started('vitest.plain.config.ts', ...flags);

    expect(await started('vitest.default.config.ts', ...flags)).toEqual(own);
  }, 60_000);

  // A file's tests are shuffled in the worker, by the seed the config hands it.
  it.each(['--sequence.shuffle', '--sequence.shuffle.tests'])('runs the tests in a file in the order Vitest gives them under `%s`', async (shuffle) => {
    const ran = async (config: string): Promise<string[]> => {
      const order = resolve(await scratch(), 'order.txt');
      await output(await scratch(), { FIXTURE_INCLUDE: 'test/several.order.ts', FIXTURE_ORDER: order }, config, shuffle, '--sequence.seed=1');
      return (await readFile(order, 'utf8')).trim().split('\n');
    };
    const own = await ran('vitest.plain.config.ts');
    expect(own).not.toEqual(own.toSorted());

    expect(await ran('vitest.default.config.ts')).toEqual(own);
  }, 60_000);
});
