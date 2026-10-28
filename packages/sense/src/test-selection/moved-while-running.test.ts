import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { moduleId } from './captured-modules.js';
import { decodeTestCoverage } from './index.js';
import SelectionReporter from './jest-reporter.js';
import { RUN_DIRECTORY_VARIABLE } from './jest.js';
import journalFormat from './journal-format.cjs';
import probeAfter from './rstest-after-loader.js';
import instrumentModule from './rstest-loader.js';
import { withTestSelection } from './rstest.js';
import { foldRun } from './selection-fold.js';
import { newRun, runOf } from './selection-run.js';

const { encodeJournal } = journalFormat;

/**
 * A precondition's digest is read when the run ends, from the disk. A test file
 * edited after its test ran and before the run ended is digested at the edit,
 * which the test never ran: the record would name the edit as ran over, and the
 * next selection would skip it. The run cannot say which text the test read, so
 * it records the test incomplete, which the next selection runs again.
 */

const made: string[] = [];
let cache: string | undefined;

afterEach(async () => {
  delete process.env[RUN_DIRECTORY_VARIABLE];
  if (cache === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  for (const directory of made.splice(0)) await rm(directory, { recursive: true, force: true });
});

const MODULE = 'module.exports = 1;\n';

/** A project with one test file, and a journal of it entering one module. */
async function project(): Promise<{ root: string; coverageFile: string; testFile: string; journal: Buffer }> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-moved-while-running-'));
  made.push(root);
  await mkdir(resolve(root, 'test'), { recursive: true });
  await mkdir(resolve(root, 'src'), { recursive: true });
  await writeFile(resolve(root, 'src/one.js'), MODULE);
  const testFile = resolve(root, 'test/a.case.js');
  await writeFile(testFile, '// a\n');
  cache = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = resolve(root, 'variance-cache');
  const journal = encodeJournal(testFile, new Map([[moduleId('src/one.js', MODULE), new Uint32Array([1])]]));
  return { root, coverageFile: resolve(root, 'coverage.bin'), testFile, journal };
}

/** Edit the file after the run began: its text, and a write time a minute past now. */
async function editWhileRunning(file: string): Promise<void> {
  await writeFile(file, '// a, edited\n');
  const later = Date.now() / 1000 + 60;
  await utimes(file, later, later);
}

const completeness = async (coverageFile: string) =>
  decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => [test.file, test.complete]);

describe('a test file edited while its run was running', () => {
  it('is recorded incomplete by the Vitest and Rstest fold', async () => {
    const { root, coverageFile, testFile, journal } = await project();
    const run = newRun(coverageFile, root, 'presence');
    await mkdir(run.runDirectory, { recursive: true });
    await writeFile(resolve(run.runDirectory, 'a.va'), journal);
    await editWhileRunning(testFile);

    await foldRun(run, { coverageFile, shims: [], derive: true })([{ filepath: testFile, complete: true }]);

    expect(await completeness(coverageFile)).toEqual([['test/a.case.js', false]]);
  });

  it('is recorded incomplete by the Jest reporter', async () => {
    const { root, coverageFile, testFile, journal } = await project();
    const reporter = new SelectionReporter(undefined, { root, coverageFile, preconditions: [] });
    reporter.onRunStart();
    const runDirectory = process.env[RUN_DIRECTORY_VARIABLE]!;
    await mkdir(runDirectory, { recursive: true });
    await writeFile(resolve(runDirectory, 'a.va'), journal);
    await editWhileRunning(testFile);

    await reporter.onRunComplete(
      new Set([{ config: { cacheDirectory: resolve(root, 'cache'), id: 'project' } }]),
      { testResults: [{ testFilePath: testFile, skipped: false, testResults: [{ status: 'passed' }] }] },
    );

    expect(await completeness(coverageFile)).toEqual([['test/a.case.js', false]]);
  });
});

describe('a setup file edited while the run was running', () => {
  it('records every test declaring it incomplete', async () => {
    const { root, coverageFile, testFile, journal } = await project();
    const setup = resolve(root, 'test/setup.js');
    await writeFile(setup, '// setup\n');
    const reporter = new SelectionReporter(undefined, { root, coverageFile, preconditions: [setup] });
    reporter.onRunStart();
    const runDirectory = process.env[RUN_DIRECTORY_VARIABLE]!;
    await mkdir(runDirectory, { recursive: true });
    await writeFile(resolve(runDirectory, 'a.va'), journal);
    await editWhileRunning(setup);

    await reporter.onRunComplete(
      new Set([{ config: { cacheDirectory: resolve(root, 'cache'), id: 'project' } }]),
      { testResults: [{ testFilePath: testFile, skipped: false, testResults: [{ status: 'passed' }] }] },
    );

    expect(await completeness(coverageFile)).toEqual([['test/a.case.js', false]]);
  });
});

describe('a test file edited while Rstest built its bundle', () => {
  // Rstest compiles the cycle, reading every test file, before it announces
  // the start, so the start it announces is too late to judge a write by.
  it('is recorded incomplete, judged from when the run was made', async () => {
    const { root, coverageFile, testFile, journal } = await project();
    const config = withTestSelection({ root }, { coverageFile });
    const run = runOf(coverageFile)!;
    // The run was made a minute ago, and the file written while the bundle built.
    run.startedAt -= 60_000;
    const during = Date.now() / 1000 - 30;
    await utimes(testFile, during, during);
    const resourcePath = resolve(root, 'src/one.js');
    let handed: string | undefined;
    let map: unknown;
    instrumentModule.call({ resourcePath, getOptions: () => ({ coverageFile }), callback: (_error, text, given) => {
      handed = text;
      map = given;
    } }, MODULE);
    probeAfter.call({ resourcePath, getOptions: () => ({ coverageFile }), callback: () => undefined }, handed!, map as never);
    await mkdir(run.runDirectory, { recursive: true });
    await writeFile(resolve(run.runDirectory, 'a.va'), journal);
    const reporter = (config.reporters as ReadonlyArray<{
      onTestRunStart(): unknown;
      onTestRunEnd(payload: object): Promise<unknown> | unknown;
    }>).at(-1)!;

    reporter.onTestRunStart();
    await reporter.onTestRunEnd({ results: [{ testPath: testFile, status: 'pass', results: [{ status: 'pass' }] }] });

    expect(await completeness(coverageFile)).toEqual([['test/a.case.js', false]]);
  });
});

describe('a setup file written before the run announced itself', () => {
  // A runner loads its configuration, and what that imports, once per process
  // and before its first run starts, so a declared file is judged from the
  // process's start, not the run's.
  it('records every test declaring it incomplete', async () => {
    const { root, coverageFile, testFile, journal } = await project();
    const setup = resolve(root, 'test/setup.js');
    await writeFile(setup, '// setup\n');
    const loaded = (performance.timeOrigin + 1) / 1000;
    await utimes(setup, loaded, loaded);
    const reporter = new SelectionReporter(undefined, { root, coverageFile, preconditions: [setup] });
    reporter.onRunStart();
    const runDirectory = process.env[RUN_DIRECTORY_VARIABLE]!;
    await mkdir(runDirectory, { recursive: true });
    await writeFile(resolve(runDirectory, 'a.va'), journal);

    await reporter.onRunComplete(
      new Set([{ config: { cacheDirectory: resolve(root, 'cache'), id: 'project' } }]),
      { testResults: [{ testFilePath: testFile, skipped: false, testResults: [{ status: 'passed' }] }] },
    );

    expect(await completeness(coverageFile)).toEqual([['test/a.case.js', false]]);
  });
});
