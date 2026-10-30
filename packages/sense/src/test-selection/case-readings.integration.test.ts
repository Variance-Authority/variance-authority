import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { caseSectionsOf } from './case-record.js';
import { readingsOf } from './case-readings.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/jest-flake');
const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

it('keeps both readings of a case that threw once and passed once over unchanged code', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-flake-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  const record = (clickFirst: boolean) => execute(process.execPath, [jest, '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'], {
    cwd: fixture,
    env: {
      ...process.env,
      CLICK_FIRST: clickFirst ? '1' : '0',
      VARIANCE_AUTHORITY_COVERAGE: coverageFile,
      VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache'),
      VARIANCE_AUTHORITY_CACHE: directory,
    },
  });

  await expect(record(true)).rejects.toThrow();
  await record(false);

  const { index, readings } = caseSectionsOf(await readFile(coverageFile));
  const test = `${relative(repository, fixture)}/test/page.case.ts`;
  const read = readingsOf(readings, index, `${test} > clicks`);
  expect(read?.map((reading) => [reading.count, reading.stopped])).toEqual([[1, false], [1, true]]);
  // `wire` opens on line 3 of the page, and only the passing reading entered it.
  const opened = (at: number) => read![at]!.regions.filter(([module]) => module.endsWith('src/page.ts')).map(([, , start]) => start);
  expect(opened(0)).toContain(3);
  expect(opened(1)).not.toContain(3);
}, 120_000);
