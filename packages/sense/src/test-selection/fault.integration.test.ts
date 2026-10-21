import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { FAULT_VARIABLE } from './cache-layers.js';
import { faultReadIn } from './fault.js';
import { decodeTestCoverage } from './format.js';

/**
 * A fault skips one region in the file a runner reads, so the tests that
 * entered it run over every other line as written. A test that checks what
 * the region did goes red; a test that only ran it passes whatever it does.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface Outcome {
  /** The tests that did not pass, by title. */
  readonly failed: readonly string[];
  /** The tests that passed, by title. */
  readonly passed: readonly string[];
  /** Whether a test file failed before its tests ran. */
  readonly refused: boolean;
  /** What the runner said of the files that failed. */
  readonly messages: string;
  readonly coverageFile: string;
  /** Whether the run marked its cache as having read the file with the region left out. */
  readonly marked: boolean;
}

interface Report {
  readonly testResults: readonly {
    readonly status: string;
    readonly message: string;
    readonly assertionResults: readonly { readonly title: string; readonly status: string }[];
  }[];
}

const RUNNERS = [
  {
    runner: 'Vitest',
    fixture: 'fault-vitest',
    command: (fixture: string, report: string) => [
      resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts'), '--reporter=json', `--outputFile=${report}`,
    ],
  },
  {
    runner: 'Jest',
    fixture: 'fault-jest',
    command: (fixture: string, report: string) => [
      resolve(repository, 'node_modules/jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false', '--json', `--outputFile=${report}`,
    ],
  },
] as const;

describe.each(RUNNERS)('a fault under $runner', ({ fixture: name, command }) => {
  const fixture = resolve(repository, 'packages/sense/test/fixtures', name);
  const pick = `${relative(repository, fixture)}/src/pick.js`;
  // One Jest cache across both runs: a faulted file must not be read back as
  // the plain one's transform, nor the plain one as the faulted.
  let jestCache: string;

  // `from` is a run whose record this one starts from, copied into its cache as a caller would.
  const run = async (fault?: string, from?: Outcome): Promise<Outcome> => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-fault-'));
    temporary.push(directory);
    if (from !== undefined) await cp(dirname(from.coverageFile), directory, { recursive: true });
    jestCache ??= await mkdtemp(resolve(tmpdir(), 'variance-authority-fault-jest-'));
    const coverageFile = resolve(directory, 'coverage.bin');
    const env = {
      ...process.env,
      VARIANCE_AUTHORITY_COVERAGE: coverageFile,
      VARIANCE_AUTHORITY_CACHE: directory,
      VARIANCE_AUTHORITY_JEST_CACHE: jestCache,
      [FAULT_VARIABLE]: fault,
    };
    if (fault === undefined) delete env[FAULT_VARIABLE];
    const report = resolve(directory, 'report.json');
    await execute(process.execPath, command(fixture, report), { cwd: fixture, env }).catch(() => undefined);
    const { testResults } = JSON.parse(await readFile(report, 'utf8')) as Report;
    const titled = (status: string) => testResults.flatMap((file) => file.assertionResults.filter((test) => test.status === status).map((test) => test.title));
    const failed = titled('failed');
    const passed = titled('passed');
    const refused = testResults.some((file) => file.status === 'failed' && file.assertionResults.every((test) => test.status !== 'failed'));
    const messages = testResults.map((file) => file.message).join('\n');
    return { failed, passed, refused, messages, coverageFile, marked: existsSync(faultReadIn(directory)) };
  };

  const ordinalOf = async (coverageFile: string, name: string, path: string): Promise<number> => {
    const module = decodeTestCoverage(await readFile(coverageFile)).modules.find((each) => each.file === pick);
    const block = module?.blocks.find((each) => each.name === name && each.path === path);
    if (block === undefined) throw new Error(`no region ${name} ${path} in ${pick}`);
    return block.ordinal;
  };

  it('turns red the test that checks the region, and leaves green the one that only ran it', async () => {
    const plain = await run();
    expect(plain.failed).toEqual([]);

    const checkedArm = await run(`${pick}#${await ordinalOf(plain.coverageFile, 'checked', 'if#0/then')}`);
    expect(checkedArm.failed).toEqual(['checks what checked returns']);

    const uncheckedArm = await run(`${pick}#${await ordinalOf(plain.coverageFile, 'unchecked', 'if#0/then')}`);
    expect(uncheckedArm.failed).toEqual([]);

    expect((await run()).failed).toEqual([]);
  }, 60_000);

  it('runs, from the record it starts from, only the cases that entered the region', async () => {
    const plain = await run();
    expect(plain.passed).toHaveLength(2);

    const faulted = await run(`${pick}#${await ordinalOf(plain.coverageFile, 'checked', 'if#0/then')}`, plain);
    expect(faulted.failed).toEqual(['checks what checked returns']);
    expect(faulted.passed).toEqual([]);
  }, 60_000);

  it('marks a run read with the region left out, a second time served from the runner\'s cache too', async () => {
    const plain = await run();
    expect(plain.marked).toBe(false);
    const fault = `${pick}#${await ordinalOf(plain.coverageFile, 'unchecked', 'if#0/then')}`;

    expect((await run(fault)).marked).toBe(true);
    expect((await run(fault)).marked).toBe(true);
  }, 60_000);

  it('refuses a region with no text of its own', async () => {
    const { refused, messages } = await run(`${pick}#0`);
    expect(refused).toBe(true);
    expect(messages).toContain('names a region with no text of its own');
  }, 30_000);
});
