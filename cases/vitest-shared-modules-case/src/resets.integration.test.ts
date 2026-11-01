import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, '../fixture');
const splitFixture = resolve(here, '../fixture-split');
// The Vitest this case installs, resolved from the case.
const vitest = resolve(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-vitest-shared-modules-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

interface Report {
  readonly testResults: readonly {
    readonly name: string;
    readonly startTime: number;
    readonly assertionResults: readonly { readonly title: string; readonly status: string }[];
  }[];
}

/**
 * One run of the fixture: what each test did, in the order the files ran, as
 * `file > title: status`, and how many times the worker evaluated `counter.ts`.
 */
async function run(
  name: string,
  env: { readonly FIXTURE_RESETS: string; readonly FIXTURE_ISOLATE?: string; readonly FIXTURE_CONCURRENT?: string; readonly FIXTURE_LIFECYCLE?: string },
) {
  const report = resolve(directory, `${name}.json`);
  const loads = resolve(directory, `${name}.loads`);
  const { output } = await execute(process.execPath, [vitest, 'run', '--reporter=json', `--outputFile=${report}`], {
    cwd: fixture,
    env: { ...process.env, ...env, FIXTURE_LOADS: loads },
  }).then(
    ({ stdout, stderr }) => ({ output: `${stdout}${stderr}` }),
    (error: { stdout?: string; stderr?: string }) => ({ output: `${error.stdout ?? ''}${error.stderr ?? ''}` }),
  );
  const parsed = JSON.parse(await readFile(report, 'utf8').catch(() => `{"testResults":[]}`)) as Report;
  const loadCount = (await readFile(loads, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
  // Which file runs first is the sequencer's choice, and it puts a file that
  // failed in an earlier run first, so the order is read from when each started.
  // The files are the same file, so only the position is named.
  const tests = [...parsed.testResults].sort((left, right) => left.startTime - right.startTime).flatMap((file, index) =>
    file.assertionResults.map((test) => `${index === 0 ? 'first' : 'second'} file > ${test.title}: ${test.status}`),
  );
  const named = parsed.testResults
    .flatMap((file) => file.assertionResults.map((test) => `${file.name.slice(fixture.length + 1)} > ${test.title}: ${test.status}`))
    .sort();
  return { output, tests, named, loads: loadCount };
}

describe('a Vitest run that keeps its module graph across files', () => {
  it('evaluates a module once, and lets every test after the first meet what it left', async () => {
    const { output, tests, loads } = await run('none', { FIXTURE_RESETS: 'none' });

    expect(loads, output).toBe(1);
    expect(tests, output).toEqual([
      'first file > counts from one: passed',
      'first file > counts from one again, whatever the test before it left: failed',
      'first file > tallies from zero: passed',
      'second file > counts from one: failed',
      'second file > counts from one again, whatever the test before it left: failed',
      'second file > tallies from zero: failed',
    ]);
  });

  it('evaluates a module once per file when Vitest isolates the files', async () => {
    const { output, tests, loads } = await run('isolated', { FIXTURE_RESETS: 'none', FIXTURE_ISOLATE: 'true' });

    expect(loads, output).toBe(2);
    expect(tests.filter((test) => test.startsWith('second')), output).toEqual([
      'second file > counts from one: passed',
      'second file > counts from one again, whatever the test before it left: failed',
      'second file > tallies from zero: passed',
    ]);
  });

  it('resets what a module registered a handler for, in every file, through a setup file Vitest runs again', async () => {
    const { output, tests, loads } = await run('ioc', { FIXTURE_RESETS: 'ioc' });

    expect(loads, output).toBe(1);
    expect(tests, output).toEqual([
      'first file > counts from one: passed',
      'first file > counts from one again, whatever the test before it left: failed',
      'first file > tallies from zero: passed',
      'second file > counts from one: failed',
      'second file > counts from one again, whatever the test before it left: failed',
      'second file > tallies from zero: passed',
    ]);
  });

  it('gives every test the values each module was loaded with once the isolator rewrites them', async () => {
    const { output, tests, loads } = await run('isolator', { FIXTURE_RESETS: 'isolator' });

    expect(loads, output).toBe(1);
    expect(tests, output).toEqual([
      'first file > counts from one: passed',
      'first file > counts from one again, whatever the test before it left: passed',
      'first file > tallies from zero: passed',
      'second file > counts from one: passed',
      'second file > counts from one again, whatever the test before it left: passed',
      'second file > tallies from zero: passed',
    ]);
  });
});

describe('tests that run side by side under a kept module graph', () => {
  it('hand each other their writes when only a reset between tests separates them', async () => {
    const { output, tests } = await run('concurrent-ioc', { FIXTURE_RESETS: 'ioc', FIXTURE_CONCURRENT: 'true' });

    expect(tests, output).toEqual([
      'first file > counts from one beside another test: failed',
      'first file > counts from one beside the first test: failed',
    ]);
  });

  it('each keep their own values once every test runs in a session of its own', async () => {
    const { output, tests } = await run('concurrent-isolator', { FIXTURE_RESETS: 'isolator', FIXTURE_CONCURRENT: 'true' });

    expect(tests, output).toEqual([
      'first file > counts from one beside another test: passed',
      'first file > counts from one beside the first test: passed',
    ]);
  });
});

describe('a test file under the isolator, as a fresh file would run', () => {
  it('collects against its modules as they were loaded, and gives each test what collection and once-per-scope hooks wrote', async () => {
    const { output, named } = await run('lifecycle', { FIXTURE_RESETS: 'isolator', FIXTURE_LIFECYCLE: 'true' });

    expect(named, output).toEqual([
      'collect-one.lifecycle.ts > collected the module as it was loaded: passed',
      'collect-one.lifecycle.ts > counts from one again, whatever the test before it left: passed',
      'collect-one.lifecycle.ts > counts from one: passed',
      'collect-two.lifecycle.ts > collected the module as it was loaded: passed',
      'collect-two.lifecycle.ts > counts from one again, whatever the test before it left: passed',
      'collect-two.lifecycle.ts > counts from one: passed',
      'seeded.lifecycle.ts > reads both again, whatever the test before it wrote: passed',
      'seeded.lifecycle.ts > reads it again, whatever the test before it wrote: passed',
      'seeded.lifecycle.ts > reads what both beforeAll hooks seeded: passed',
      'seeded.lifecycle.ts > reads what the describe seeded, after it, as a fresh file does: passed',
      "seeded.lifecycle.ts > reads what the file's beforeAll seeded: passed",
    ]);
  });
});

describe('the isolator README\'s Vitest config', () => {
  async function split(value: string) {
    const report = resolve(directory, `split-${value}.json`);
    const { stdout, stderr } = await execute(process.execPath, [vitest, 'run', '--reporter=json', `--outputFile=${report}`], {
      cwd: splitFixture,
      env: { ...process.env, FIXTURE_SPLIT: value },
    }).catch((error: { stdout?: string; stderr?: string }) => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? '' }));
    const parsed = JSON.parse(await readFile(report, 'utf8').catch(() => `{"testResults":[]}`)) as Report;
    const tests = parsed.testResults
      .flatMap((file) => file.assertionResults.map((test) => `${file.name.slice(splitFixture.length + 1)} > ${test.title}: ${test.status}`))
      .sort();
    return { output: `${stdout}${stderr}`, tests };
  }

  it('gives a file that mocks a module another file loaded first a worker of its own', async () => {
    const { output, tests } = await split('true');

    expect(tests, output).toEqual(['src/a.case.ts > reads the module as it is: passed', 'src/b.mocked.case.ts > reads the mocked module: passed']);
  });

  it('loses the mock when that file shares the worker', async () => {
    const { output, tests } = await split('false');

    expect(tests, output).toEqual(['src/a.case.ts > reads the module as it is: passed', 'src/b.mocked.case.ts > reads the mocked module: failed']);
  });
});
