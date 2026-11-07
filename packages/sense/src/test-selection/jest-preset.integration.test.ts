import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const fixture = resolve(root, 'packages/sense/test/fixtures/jest-preset');

it.each([
  ['names no `transform`', undefined],
  ['sets `transform: {}`', '{}'],
  ['names a `transform` for other files', '{"\\\\.css$":"<rootDir>/strip-types.cjs"}'],
])('compiles on the first run through the preset\'s transformer, and records it, when the object %s', async (_, transform) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-jest-preset-'));
  try {
    const coverageFile = resolve(directory, 'coverage.bin');
    await execute(process.execPath, [resolve(root, 'node_modules/jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--runInBand', '--watchman=false'], {
      cwd: fixture,
      env: {
        ...process.env,
        FIXTURE_COVERAGE: coverageFile,
        FIXTURE_CACHE: resolve(directory, 'cache'),
        ...(transform === undefined ? {} : { FIXTURE_TRANSFORM: transform }),
      },
    });
    const record = decodeTestCoverage(await readFile(coverageFile));
    expect(record.tests.map((test) => test.complete)).toEqual([true]);
    expect(record.modules.find((module) => module.file === relative(root, resolve(fixture, 'src/add.ts')))?.instrumented).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
