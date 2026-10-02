import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeExecutionIndex } from './execution-format.js';
import type { CasePrecondition } from './case-precondition-column.js';
import type { ExecutionIndex } from './reverse.js';

// One test file per runner says the same things from the same places — a file
// default, a describe-scoped `beforeEach`, a describe callback, a `beforeAll`
// that contradicts itself, an `afterEach` — and each runner's recording has to
// lay them on the same rows. The Vitest fixture adds a concurrent pair and a
// retry, which the other two runners spell differently.

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
}

const runners: Readonly<Record<'vitest' | 'jest' | 'rstest', Runner>> = {
  vitest: {
    fixture: 'preconditions-vitest',
    join: ' > ',
    args: (fixture) => [bin('vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts')],
  },
  jest: {
    fixture: 'preconditions-jest',
    join: ' ',
    args: (fixture) => [bin('jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'],
    env: (directory) => ({ VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache') }),
  },
  rstest: {
    fixture: 'preconditions-rstest',
    join: ' > ',
    args: (fixture) => [bin('@rstest/core/bin/rstest.js'), 'run', '-c', resolve(fixture, 'rstest.config.mjs')],
  },
};

describe.each(Object.entries(runners))('a %s case that names its preconditions', (runnerName, runner) => {
  const fixture = resolve(repository, 'packages/sense/test/fixtures', runner.fixture);
  const checkout = `${relative(repository, fixture)}/test/checkout.case.ts`;
  let directory: string;
  let index: ExecutionIndex;
  let output: string;
  let source: readonly string[];

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), `variance-authority-preconditions-${runnerName}-`));
    const coverageFile = resolve(directory, 'coverage.bin');
    output = await execute(process.execPath, runner.args(fixture), {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: coverageFile,
        VARIANCE_AUTHORITY_CACHE: directory,
        ...runner.env?.(directory),
      },
    }).then(({ stdout, stderr }) => `${stdout}${stderr}`);
    index = decodeExecutionIndex(await readFile(coverageFile));
    source = (await readFile(resolve(fixture, 'test/checkout.case.ts'), 'utf8')).split('\n');
  }, 120_000);

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /** The fixture's line whose trailing comment names the call. */
  const line = (call: string): number => source.findIndex((text) => text.endsWith(`// ${call}`)) + 1;
  const said = (name: string, value: CasePrecondition['value'], call: string): CasePrecondition =>
    ({ name, value, site: `${checkout}:${line(call)}` });
  const row = (...path: readonly string[]) => {
    const name = path.join(runner.join);
    const found = index.tests.find((test) => test.name === name);
    expect(found, `${name} among ${index.tests.map((test) => test.name).join(', ')}`).toBeDefined();
    return found!;
  };

  it('carries what its body said, with the call site, over what a wider scope said', () => {
    expect(row('mocked', 'refunds behind a flag').preconditions).toEqual([
      said('flag', 'ff-on', 'case flag'),
      said('network', 'mocked', 'mocked each'),
    ]);
    expect(row('live', 'replays a recording').preconditions).toEqual([
      said('network', 'recorded', 'case network'),
      said('region', 'eu', 'live describe'),
    ]);
  });

  it('carries what a describe-scoped beforeEach said, which a sibling describe never hears', () => {
    expect(row('mocked', 'pays').preconditions).toEqual([said('network', 'mocked', 'mocked each')]);
    expect(row('live', 'pays').preconditions).toEqual([
      said('network', 'live', 'file default'),
      said('region', 'eu', 'live describe'),
    ]);
  });

  it('keeps two values said at one level as a contradiction', () => {
    expect(row('contradicted', 'pays').preconditions).toEqual([
      said('flag', 'ff-off', 'contradicted off'),
      said('flag', 'ff-on', 'contradicted on'),
      said('network', 'live', 'file default'),
    ]);
  });

  it('gives a case that crossed nothing a row, and a case that said nothing an empty one', () => {
    expect(row('crosses nothing').preconditions).toEqual([
      said('network', 'live', 'file default'),
      said('seeded', true, 'seeded'),
    ]);
    expect(row('says nothing').preconditions).toEqual([]);
  });

  it('reports a call in afterEach with its site and lays it on no case', () => {
    expect(output).toMatch(new RegExp(`variancePrecondition at \\S*checkout\\.case\\.ts:${line('after each')} ran after its case`));
    expect(index.tests.flatMap((test) => test.preconditions ?? []).some((held) => held.name === 'cleaned')).toBe(false);
  });

  it.runIf(runnerName === 'vitest')('tells two concurrent cases and their hooks apart', () => {
    expect(row('lanes', 'left').preconditions).toEqual([
      said('lane', 'left', 'lane each'),
      said('network', 'live', 'file default'),
      said('side', 'left', 'left side'),
    ]);
    expect(row('lanes', 'right').preconditions).toEqual([
      said('lane', 'right', 'lane each'),
      said('network', 'live', 'file default'),
      said('side', 'right', 'right side'),
    ]);
  });

  it.runIf(runnerName === 'vitest')('keeps both values of a retry that changed its mind', () => {
    expect(row('retries').preconditions).toEqual([
      said('attempt', 1, 'retried'),
      said('attempt', 2, 'retried'),
      said('network', 'live', 'file default'),
    ]);
  });
});
