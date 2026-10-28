import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-jest');
const jest = resolve(repository, 'node_modules/jest/bin/jest.js');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("a Jest file whose journal loses a module Jest's registry holds", () => {
  it('fails, names the module, and leaves the file incomplete in the record', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-registry-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    const failed = await execute(
      process.execPath,
      [jest, '--config', resolve(fixture, 'jest.dropping.config.mjs'), '--watchman=false', 'test/alpha.case.ts'],
      {
        cwd: fixture,
        env: {
          ...process.env,
          VARIANCE_AUTHORITY_COVERAGE: coverageFile,
          VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache'),
          VARIANCE_AUTHORITY_CACHE: directory,
        },
      },
    ).then(() => undefined, (error: { code: number; stderr: string }) => error);

    expect(failed?.code).toBe(1);
    expect(failed?.stderr).toContain('variance-authority recorded none of these modules');
    expect(failed?.stderr).toContain('packages/sense/test/fixtures/external-jest/src/decide.ts');
    // No journal, so the record holds the file as incomplete: evidence of
    // nothing, run whatever changes.
    const recorded = decodeTestCoverage(await readFile(coverageFile)).tests;
    expect(recorded.map((test) => [test.file, test.complete])).toEqual([
      ['packages/sense/test/fixtures/external-jest/test/alpha.case.ts', false],
    ]);
  });
});
