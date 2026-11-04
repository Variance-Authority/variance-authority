import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { instrumentationId } from '../instrument/index.js';
import { readTestCoverage, testCoverageFile, writeTestCoverage } from './index.js';

/**
 * A run of a newer build over a record an older one left: the runner runs for
 * real, and what it exits with and prints is what the operator sees.
 */

const execute = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const OLDER = 'sense:instrument/presence-v0';
const NEWER = instrumentationId('presence');
const LEFT = 'elsewhere/left.test.ts';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-replaced-record-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** A record the older build wrote at `file`, and its bytes. */
async function older(file: string): Promise<Buffer> {
  await mkdir(dirname(file), { recursive: true });
  await writeTestCoverage(file, {
    version: 3,
    instrumentation: OLDER,
    tests: [{ file: LEFT, complete: true, preconditions: [] }],
    modules: [],
  });
  return readFile(file);
}

/** How each runner is run: its arguments, the fixture it runs, and the test file that fixture records. */
const runners = {
  Vitest: {
    fixture: 'packages/sense/test/fixtures/idle-case-vitest',
    command: (args: readonly string[], config = 'vitest.config.ts') => [resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config, ...args],
    ran: 'packages/sense/test/fixtures/idle-case-vitest/test/add.case.ts',
  },
  Jest: {
    fixture: 'packages/sense/test/fixtures/external-jest',
    command: (args: readonly string[], config = 'jest.config.mjs') => [resolve(repository, 'node_modules/jest/bin/jest.js'), '--config', config, '--watchman=false', ...args],
    ran: 'packages/sense/test/fixtures/external-jest/test/alpha.case.ts',
  },
} as const;

/** One real run recording at `file`, and what it printed on stderr. Rejects when the run exits other than 0. */
async function run(runner: keyof typeof runners, file: string, args: readonly string[] = [], config?: string): Promise<string> {
  const { fixture, command } = runners[runner];
  const { stderr } = await execute(process.execPath, [...command(args, config)], {
    cwd: resolve(repository, fixture),
    env: {
      ...process.env,
      VARIANCE_AUTHORITY_COVERAGE: file,
      VARIANCE_AUTHORITY_CACHE: directory,
      VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'jest'),
    },
  });
  return stderr;
}

describe.each(['Vitest', 'Jest'] as const)('a %s run over a record under other probes', (runner) => {
  const cached = (): string => testCoverageFile(repository, { cacheRoot: directory, suite: 'unit' });

  it.each([
    ['whole', []],
    ['as a shard of a run that selects nothing', ['--shard=1/1']],
  ])('replaces the one in the checkout\'s cache and stays green, %s', async (_how, args) => {
    const file = cached();
    await older(file);

    const said = await run(runner, file, args);

    const record = await readTestCoverage(file);
    expect(record.instrumentation).toBe(NEWER);
    expect(record.tests.map((test) => test.file)).toContain(runners[runner].ran);
    expect(record.tests.map((test) => test.file)).not.toContain(LEFT);
    expect(said.split('\n').filter((line) => line.includes(file) && line.includes(OLDER) && line.includes(NEWER))).toHaveLength(1);
  }, 120_000);

  it('refuses the one at a path it was handed, and leaves it byte for byte', async () => {
    const file = resolve(directory, 'handed-in', 'coverage.bin');
    const before = await older(file);

    await expect(run(runner, file)).rejects.toThrow(/this run cannot be laid over the record at .*It was written by another build/su);

    expect(Buffer.compare(await readFile(file), before)).toBe(0);
  }, 120_000);
});

describe('a run that instruments no module, over a cached record under other probes', () => {
  it.each([
    ['Vitest', 'vitest.unprobed.config.ts'],
    ['Jest', 'jest.idle.config.mjs'],
  ] as const)('leaves it under its probes and says nothing of a replacement, from %s', async (runner, config) => {
    const file = testCoverageFile(repository, { cacheRoot: directory, suite: 'unit' });
    await older(file);

    const said = await run(runner, file, [], config);

    expect((await readTestCoverage(file)).instrumentation).toBe(OLDER);
    expect(said).not.toContain('replaced the record');
  }, 120_000);
});

it('leaves a record under this build\'s probes for the run to lay over', async () => {
  const file = testCoverageFile(repository, { cacheRoot: directory, suite: 'unit' });
  await mkdir(dirname(file), { recursive: true });
  await writeTestCoverage(file, { version: 3, instrumentation: NEWER, tests: [{ file: LEFT, complete: true, preconditions: [] }], modules: [] });

  await run('Vitest', file);

  expect((await readTestCoverage(file)).tests.map((test) => test.file)).toContain(LEFT);
}, 120_000);
