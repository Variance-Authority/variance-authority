import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeTestCoverage } from './format.js';
import type { CoverageModule } from './index.js';

/**
 * The probes go in before Vitest lifts `vi.mock` and `vi.hoisted` above a
 * module's imports. `src/frozen.ts` mocks its own import of `src/clock.ts` with
 * a hoisted value, and `test/price.case.ts` replaces one export of
 * `src/price.ts` and keeps the original's other. Both suites pass only if the
 * hoisting still happened, so the run finishing is half the claim; the record
 * is the other half.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/hoisted-mocks-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;

let directory: string;
let modules: readonly CoverageModule[];

/** The test files that entered the region called `name` in `file`. */
const entered = (file: string, name: string): readonly string[] | undefined =>
  modules.find((module) => module.file === named(file))?.blocks.find((block) => block.name === name)?.testFiles;

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-hoisted-mocks-'));
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
  });
  modules = decodeTestCoverage(await readFile(coverageFile)).modules;
}, 30_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('a module whose mocks Vitest hoists after the probes', () => {
  it('records its own load and its function under the test that imported it', () => {
    const frozen = modules.find((module) => module.file === named('src/frozen.ts'));

    expect(frozen?.instrumented).toBe(true);
    // The module probe sits below the imports, and the hoisted block went above them.
    expect(frozen?.blocks.find((block) => block.kind === 'module')?.testFiles).toEqual([named('test/frozen.case.ts')]);
    expect(entered('src/frozen.ts', 'stamp')).toEqual([named('test/frozen.case.ts')]);
    // Replaced by the factory, so never loaded.
    expect(entered('src/clock.ts', 'now') ?? []).toEqual([]);
  });

  it('records the original of a partly mocked module under the test that reached it', () => {
    expect(entered('src/price.ts', 'total')).toEqual([named('test/price.case.ts')]);
    // The original `total` calls the original `discount`; the test's own call reached the mock.
    expect(entered('src/price.ts', 'discount')).toEqual([named('test/price.case.ts')]);
  });
});
