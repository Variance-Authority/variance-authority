import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { writeTestCoverage } from './index.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-jest');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
const FOUND = ['alpha', 'beta', 'delta', 'each', 'gamma'].map((name) => at(`test/${name}.case.ts`));

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-selected-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** One run of the Jest fixture, handed `skip`: what it printed and which test files it recorded. */
async function run(name: string, skip: readonly string[], ...args: string[]) {
  return runWith(name, { FIXTURE_SKIP: JSON.stringify(skip) }, ...args);
}

async function runWith(name: string, fixtureEnv: Record<string, string>, ...args: string[]) {
  const coverageFile = resolve(directory, `${name}.bin`);
  const { stdout, stderr } = await execute(
    process.execPath,
    [jest, '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false', ...args],
    {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: coverageFile,
        VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'jest-cache'),
        VARIANCE_AUTHORITY_CACHE: resolve(directory, name),
        ...fixtureEnv,
      },
    },
  );
  const ran = existsSync(coverageFile)
    ? [...new Set(decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file))].sort()
    : [];
  return { stdout, stderr, ran };
}

describe('a Jest run handed a selection', () => {
  it('runs what the selection kept, and counts it against what Jest found', async () => {
    const { stderr, ran } = await run('kept', [at('test/alpha.case.ts'), at('test/gamma.case.ts')]);

    expect(ran).toEqual(FOUND.filter((file) => !/alpha|gamma/.test(file)));
    expect(stderr).toContain('variance-authority: selected 3 of 5');
  }, 60_000);

  it('splits what the selection kept across shards, never what it skipped', async () => {
    const skip = [at('test/alpha.case.ts'), at('test/gamma.case.ts')];
    const first = await run('first', skip, '--shard', '1/2');
    const second = await run('second', skip, '--shard', '2/2');

    expect([...first.ran, ...second.ran].sort()).toEqual(FOUND.filter((file) => !/alpha|gamma/.test(file)));
  }, 60_000);

  it('lists only what the selection kept', async () => {
    const { stdout } = await run('listed', [at('test/alpha.case.ts')], '--listTests');

    expect(stdout).not.toContain('alpha.case.ts');
    expect(stdout).toContain('beta.case.ts');
  }, 60_000);
});

describe('a Jest run handed the cases to skip in a file it runs', () => {
  // Two files, two workers, and a Jest cache with no times in it, which Jest
  // would otherwise read as fast tests and run in band: the cut reaches a
  // worker the filter's process forked.
  it('runs the other cases of that file, in a worker, and records the file incomplete', async () => {
    const report = resolve(directory, 'cut.json');
    await runWith('cut', {
      FIXTURE_SKIP: JSON.stringify(FOUND.filter((file) => !/alpha|beta/.test(file))),
      FIXTURE_CASES: JSON.stringify({ [at('test/alpha.case.ts')]: ['ran after the project\'s own setup file'] }),
      VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'jest-cache-cut'),
    }, '--maxWorkers=2', '--json', '--outputFile', report);
    const { testResults } = JSON.parse(await readFile(report, 'utf8')) as {
      testResults: { name: string; assertionResults: { title: string; status: string }[] }[];
    };
    const alpha = testResults.find((file) => file.name.endsWith('alpha.case.ts'))!;
    const recorded = decodeTestCoverage(await readFile(resolve(directory, 'cut.bin'))).tests;

    expect(alpha.assertionResults.map(({ title, status }) => [title, status])).toEqual([
      ['takes the alpha path', 'passed'],
      ['ran after the project\'s own setup file', 'pending'],
      ['is skipped, and so never reaches the B branch this file is not selected for', 'pending'],
    ]);
    expect(recorded.map(({ file, complete }) => ({ file, complete }))).toEqual([
      { file: at('test/alpha.case.ts'), complete: false },
      { file: at('test/beta.case.ts'), complete: true },
    ]);
  }, 60_000);
});

describe('a Jest run under --shard, with the times a record holds', () => {
  it('places each file by its recorded time, and says what each shard takes', async () => {
    // Alpha is recorded as the slow one, so on two shards it is alone on the first.
    const timed = (k: number) => writeTestCoverage(resolve(directory, `timed-${k}.bin`), {
      version: 3,
      instrumentation: 'fixture',
      tests: FOUND.map((file) => ({ file, complete: true, preconditions: [], duration: file.includes('alpha') ? 9000 : 100 })),
      modules: [],
    });
    await Promise.all([timed(1), timed(2)]);

    const first = await run('timed-1', [], '--shard', '1/2');
    const second = await run('timed-2', [], '--shard', '2/2');

    expect(first.stderr).toContain('variance-authority: shard 1/2 by the times recorded at');
    expect(first.stderr).toContain('1 of 5 files, 9.0 s (shards 400 ms to 9.0 s)');
    expect(first.stderr).toMatch(/PASS .*alpha\.case\.ts/);
    expect(first.stderr).not.toMatch(/PASS .*beta\.case\.ts/);
    for (const name of ['beta', 'delta', 'each', 'gamma']) expect(second.stderr).toMatch(new RegExp(`PASS .*${name}\\.case\\.ts`));
    expect(second.stderr).not.toMatch(/PASS .*alpha\.case\.ts/);
  }, 60_000);
});
