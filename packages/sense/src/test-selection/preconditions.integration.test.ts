import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeExecutionIndex } from './execution-format.js';
import { readsOf, rowOf, type CasePrecondition } from './case-said.js';
import type { ExecutionIndex } from './reverse.js';

// One test file per runner says the same things from the same places — a
// `beforeEach` at the top of the file and ones inside describes, a case body, a `beforeEach` that
// contradicts itself, one that fails after it spoke, an `afterEach` — and each
// runner's recording has to lay them on the same rows. A second file calls
// where no case is running, which throws. Vitest and Rstest add a concurrent
// pair and a retry in the same file; Jest's retry is a file of its own, because
// `jest.retryTimes` is.

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const bin = (path: string): string => resolve(repository, 'node_modules', path);

interface Runner {
  readonly fixture: string;
  /** How the runner joins a describe path into the case name it reports. */
  readonly join: string;
  readonly args: (fixture: string) => readonly string[];
  readonly env?: (directory: string) => NodeJS.ProcessEnv;
  /** The file its retried case is declared in. */
  readonly retries: string;
}

const runners: Readonly<Record<'vitest' | 'jest' | 'rstest', Runner>> = {
  vitest: {
    fixture: 'preconditions-vitest',
    join: ' > ',
    args: (fixture) => [bin('vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts')],
    retries: 'checkout.case.ts',
  },
  jest: {
    fixture: 'preconditions-jest',
    join: ' ',
    args: (fixture) => [bin('jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'],
    env: (directory) => ({ VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache') }),
    retries: 'retries.case.ts',
  },
  rstest: {
    fixture: 'preconditions-rstest',
    join: ' > ',
    args: (fixture) => [bin('@rstest/core/bin/rstest.js'), 'run', '-c', resolve(fixture, 'rstest.config.mjs')],
    retries: 'checkout.case.ts',
  },
};

describe.each(Object.entries(runners))('a %s case that names its preconditions', (runnerName, runner) => {
  const fixture = resolve(repository, 'packages/sense/test/fixtures', runner.fixture);
  const tests = `${relative(repository, fixture)}/test`;
  let directory: string;
  let index: ExecutionIndex;
  let output: string;
  const sources = new Map<string, readonly string[]>();

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), `variance-authority-preconditions-${runnerName}-`));
    const coverageFile = resolve(directory, 'coverage.bin');
    // The run fails on purpose: a case whose beforeEach throws.
    output = await execute(process.execPath, runner.args(fixture), {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: coverageFile,
        VARIANCE_AUTHORITY_CACHE: directory,
        ...runner.env?.(directory),
      },
    }).then(
      ({ stdout, stderr }) => `${stdout}${stderr}`,
      (failed: { stdout?: string; stderr?: string }) => `${failed.stdout ?? ''}${failed.stderr ?? ''}`,
    );
    index = decodeExecutionIndex(await readFile(coverageFile));
    for (const file of new Set(['checkout.case.ts', 'misplaced.case.ts', runner.retries])) {
      sources.set(file, (await readFile(resolve(fixture, 'test', file), 'utf8')).split('\n'));
    }
  }, 120_000);

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /** The fixture's line whose trailing comment names the call. */
  const line = (call: string, file = 'checkout.case.ts'): number =>
    sources.get(file)!.findIndex((text) => text.endsWith(`// ${call}`)) + 1;
  /** How deep each call's beforeEach was declared; a call in a case body is at 65535. */
  const levels: Readonly<Record<string, number>> = {
    'file default': 0,
    'mocked each': 1,
    'live each': 1,
    'contradicted on': 1,
    'contradicted off': 1,
    'lane each': 1,
  };
  const said = (name: string, value: CasePrecondition['value'], call: string, file = 'checkout.case.ts'): CasePrecondition =>
    ({ name, value, site: `${tests}/${file}:${line(call, file)}`, level: levels[call] ?? 0xffff });
  const row = (...path: readonly string[]) => {
    const name = path.join(runner.join);
    const found = index.tests.find((test) => test.name === name);
    expect(found, `${name} among ${index.tests.map((test) => test.name).join(', ')}`).toBeDefined();
    return found!;
  };

  it('carries what its body said, with the call site, over what a beforeEach said', () => {
    expect(rowOf(row('mocked', 'refunds behind a flag'))).toEqual([
      said('fixture:flag', 'ff-on', 'case flag'),
      said('fixture:network', 'mocked', 'mocked each'),
    ]);
    expect(rowOf(row('live', 'replays a recording'))).toEqual([
      said('fixture:network', 'recorded', 'case network'),
      said('fixture:region', 'eu', 'live each'),
    ]);
  });

  it('carries what a beforeEach inside a describe said, which a sibling describe never hears', () => {
    expect(rowOf(row('mocked', 'pays'))).toEqual([said('fixture:network', 'mocked', 'mocked each')]);
    expect(rowOf(row('live', 'pays'))).toEqual([
      said('fixture:network', 'live', 'file default'),
      said('fixture:region', 'eu', 'live each'),
    ]);
    // Named as if they were under `mocked`, and not under it.
    expect(rowOf(row('mocked flow', 'pays'))).toEqual([said('fixture:network', 'live', 'file default')]);
    expect(rowOf(row('mocked refunds'))).toEqual([said('fixture:network', 'live', 'file default')]);
  });

  it('keeps two values said at one level as a contradiction', () => {
    expect(rowOf(row('contradicted', 'pays'))).toEqual([
      said('fixture:flag', 'ff-off', 'contradicted off'),
      said('fixture:flag', 'ff-on', 'contradicted on'),
      said('fixture:network', 'live', 'file default'),
    ]);
  });

  it('lays what a failing beforeEach said on no later case', () => {
    expect(rowOf(row('after doomed', 'pays'))).toEqual([said('fixture:network', 'live', 'file default')]);
    expect(index.tests.flatMap((test) => rowOf(test) ?? []).some((held) => held.name === 'fixture:doomed')).toBe(false);
  });

  it('gives a case that crossed nothing a row, and a case that said nothing an empty one', () => {
    expect(rowOf(row('crosses nothing'))).toEqual([
      said('fixture:network', 'live', 'file default'),
      said('fixture:seeded', true, 'seeded'),
    ]);
    expect(rowOf(row('says nothing'))).toEqual([]);
  });

  it('reports a call in afterEach with its site and lays it on no case', () => {
    expect(output).toMatch(new RegExp(`variancePrecondition at \\S*checkout\\.case\\.ts:${line('after each')} ran after its case`));
    expect(index.tests.flatMap((test) => rowOf(test) ?? []).some((held) => held.name === 'fixture:cleaned')).toBe(false);
  });

  it('throws where no case is running: the top level, a describe callback, a beforeAll and an afterAll', () => {
    // The case asserts what the first three threw, so it finishing is the answer.
    expect(row('outside', 'throws at the top level, in a describe callback and in a beforeAll').stopped).toBe(false);
    expect(output).toMatch(new RegExp(
      `variancePrecondition at \\S*misplaced\\.case\\.ts:${line('in an afterAll', 'misplaced.case.ts')} ran in an afterAll`,
    ));
  });

  it('keeps both values of a retry that changed its mind', () => {
    expect(rowOf(row('retries'))).toEqual([
      said('fixture:attempt', 1, 'retried', runner.retries),
      said('fixture:attempt', 2, 'retried', runner.retries),
      ...runner.retries === 'checkout.case.ts' ? [said('fixture:network', 'live', 'file default')] : [],
    ]);
  });

  it.runIf(runnerName !== 'jest')('tells two concurrent cases and their hooks apart', () => {
    expect(rowOf(row('lanes', 'left'))).toEqual([
      said('fixture:lane', 'left', 'lane each'),
      said('fixture:network', 'live', 'file default'),
      said('fixture:side', 'left', 'left side'),
    ]);
    expect(rowOf(row('lanes', 'right'))).toEqual([
      said('fixture:lane', 'right', 'lane each'),
      said('fixture:network', 'live', 'file default'),
      said('fixture:side', 'right', 'right side'),
    ]);
  });

  it.todo('a Jest test.concurrent pair — needs a Jest recording under continuations, whose concurrent bodies start before their hooks run');

  describe('what the code under test read', () => {
    const flags = `${relative(repository, fixture)}/src/flags.ts`;
    const read = async (name: string, value: CasePrecondition['value'], call: string, level: number): Promise<CasePrecondition> => {
      const lines = (await readFile(resolve(repository, flags), 'utf8')).split('\n');
      return { name, value, site: `${flags}:${lines.findIndex((text) => text.endsWith(`// ${call}`)) + 1}`, level };
    };

    it('lays a read in a case on that case, and one made as the file loaded on every case of the file', async () => {
      const loaded = await read('copy:label', 'Pay', 'load read', 0);
      expect(readsOf(row('reads the flag on'))).toEqual([loaded, await read('flags:checkout', true, 'flag read', 0xffff)]);
      expect(readsOf(row('reads only what the file read as it loaded'))).toEqual([loaded]);
    });

    it('keeps both values one key was read with in one case', async () => {
      expect(readsOf(row('reads the flag both ways'))).toEqual([
        await read('copy:label', 'Pay', 'load read', 0),
        await read('flags:checkout', false, 'flag read', 0xffff),
        await read('flags:checkout', true, 'flag read', 0xffff),
      ]);
    });

    it('gives a case of a file that read nothing an empty read', () => {
      expect(readsOf(row('says nothing'))).toEqual([]);
    });
  });
});
