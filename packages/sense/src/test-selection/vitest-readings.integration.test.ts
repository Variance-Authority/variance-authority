import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeExecutionIndex } from './execution-format.js';
import { decodeTestCoverage } from './format.js';
import type { CoverageModule } from './index.js';
import { coveringTests, type ExecutionIndex } from './reverse.js';

/**
 * One test reaches `src/cart.ts`, the other reaches `build/cart.js`, a build of
 * it whose map leads back to the source. Both readings are recorded under
 * `src/cart.ts`, and they number their regions differently: the build carries
 * a helper the source never wrote, so every region after it sits one ordinal
 * further on. A test that ran the build is credited with the regions the build
 * ran, read in the source's lines.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/readings-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;

let directory: string;
let cart: CoverageModule | undefined;
let cases: ExecutionIndex;

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-readings-'));
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
  });
  const written = await readFile(coverageFile);
  const { modules } = decodeTestCoverage(written);
  cases = decodeExecutionIndex(written);
  cart = modules.find((module) => module.file === named('src/cart.ts'));
}, 30_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const testsOn = (name: string, path: string): readonly string[] | undefined =>
  cart?.blocks.find((block) => block.name === name && block.path === path)?.testFiles;

describe('a module one test reaches as source and another as its build', () => {
  it('credits the branch an empty cart takes to the test that took it, and to no other', () => {
    expect(testsOn('total', 'if#0/then')).toEqual([named('test/source.case.ts')]);
  });

  it('credits the test that ran the build with the lines the build ran', () => {
    expect(testsOn('total', 'entry')).toEqual([named('test/build.case.ts'), named('test/source.case.ts')]);
    expect(testsOn('total', 'if#0/after')).toEqual([named('test/build.case.ts')]);
  });

  it('reads the line an empty cart returns on to the case that returned there, and to no other', () => {
    const readers = coveringTests(cases, { file: named('src/cart.ts'), line: 3 }).map((test) => test.name);

    expect(readers).toEqual(['totals an empty cart']);
  });
});
