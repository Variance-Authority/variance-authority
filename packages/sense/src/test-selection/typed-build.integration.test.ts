import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { decodeTestCoverage } from './format.js';

/**
 * A build of a module of nothing but types, loaded by one test, and a run of
 * the other test alone landed over the record of both.
 *
 * `tsc` writes `build/shapes.js` as `export {};` and a `sourceMappingURL`
 * comment, beside a map whose mappings are empty: there is no position to give
 * an origin to, so the module is recorded under its own name. Vite hands the
 * plugin that file with the comment blanked in place. The record is a claim
 * about the file, and the landing that carries it checks the claim against the
 * file on disk; a run that did not load the build must find it where the run
 * that did left it, and keep the test that loaded it whole.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/typed-build-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;

let directory: string;
let coverageFile: string;

/** Run the fixture's tests, or the files named, landing over what the runs before recorded. */
async function run(files: readonly string[] = []) {
  await execute(process.execPath, [vitest, 'run', ...files, '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
  });
  return decodeTestCoverage(await readFile(coverageFile));
}

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-typed-build-'));
  coverageFile = resolve(directory, 'coverage.bin');
}, 30_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('a build of a module of types, recorded under its own name', () => {
  it('is recorded as the file on disk, not the text the dev server handed over', async () => {
    const coverage = await run();
    const row = coverage.modules.find((module) => module.file === named('build/shapes.js'));

    expect(row?.blocks.map((block) => [block.kind, block.testFiles])).toEqual([
      ['module', [named('test/shapes.case.ts')]],
    ]);
    expect(row?.sourceDigest).toBe(digestString(await readFile(resolve(fixture, 'build/shapes.js'), 'utf8')));
  }, 30_000);

  it('keeps the test that loaded it whole when a run that did not load it lands', async () => {
    const coverage = await run(['test/scale.case.ts']);

    expect(coverage.tests.map((test) => [test.file, test.complete])).toEqual([
      [named('test/scale.case.ts'), true],
      [named('test/shapes.case.ts'), true],
    ]);
  }, 30_000);
});
