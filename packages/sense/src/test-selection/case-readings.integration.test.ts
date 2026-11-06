import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { caseSectionsOf } from './case-record.js';
import { readingsOf } from './case-readings.js';
import { compareOutcomes } from '../story/outcomes.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const bin = (path: string): string => resolve(repository, 'node_modules', path);

/** Each runner over one fixture: a case that throws when it clicks before it wires the handler. */
const runners = {
  jest: {
    args: (fixture: string) => [bin('jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'],
    env: (directory: string): NodeJS.ProcessEnv => ({ VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache') }),
  },
  vitest: { args: (fixture: string) => [bin('vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts')] },
  rstest: { args: (fixture: string) => [bin('@rstest/core/bin/rstest.js'), 'run', '-c', resolve(fixture, 'rstest.config.mjs')] },
} as const satisfies Record<string, { args: (fixture: string) => string[]; env?: (directory: string) => NodeJS.ProcessEnv }>;
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.each(Object.entries(runners))('a %s case that fails on some runs', (name, runner: { args: (fixture: string) => string[]; env?: (directory: string) => NodeJS.ProcessEnv }) => {
  const fixture = resolve(repository, `packages/sense/test/fixtures/${name}-flake`);

  it('keeps both readings of a case that threw once and passed once over unchanged code', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), `variance-authority-${name}-flake-`));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    const record = (clickFirst: boolean) => execute(process.execPath, runner.args(fixture), {
      cwd: fixture,
      env: {
        ...process.env,
        CLICK_FIRST: clickFirst ? '1' : '0',
        VARIANCE_AUTHORITY_COVERAGE: coverageFile,
        VARIANCE_AUTHORITY_CACHE: directory,
        ...runner.env?.(directory),
      },
    });

    await expect(record(true)).rejects.toThrow();
    await record(false);

    const { index, readings } = caseSectionsOf(await readFile(coverageFile));
    const test = `${relative(repository, fixture)}/test/page.case.ts`;
    const read = readingsOf(readings, index, `${test} > clicks`);
    expect(read?.map((reading) => [reading.count, reading.stopped])).toEqual([[1, false], [1, true]]);
    // `wire` opens on line 3 of the page, and only the passing reading entered it.
    const opened = (at: number) => read![at]!.regions.filter(([module]) => module.endsWith('src/page.ts')).map(([, , , start]) => start);
    expect(opened(0)).toContain(3);
    expect(opened(1)).not.toContain(3);

    // Twice each, the comparison by outcome names `wire` as what only the passing runs reached,
    await expect(record(true)).rejects.toThrow();
    await record(false);
    const twice = caseSectionsOf(await readFile(coverageFile));
    const compared = compareOutcomes({ file: test, name: 'clicks', readings: readingsOf(twice.readings, twice.index, `${test} > clicks`)! });
    expect(compared).toMatchObject({ passed: 2, threw: 2, single: false });
    expect(compared!.onlyPassed.map(({ name }) => name)).toContain('wire');
    // and the branch that throws as what only the failing runs reached.
    expect(compared!.onlyThrew.map(({ name, path }) => `${name} ${path}`)).toEqual(['handle if#0/then']);
  }, 240_000);
});
