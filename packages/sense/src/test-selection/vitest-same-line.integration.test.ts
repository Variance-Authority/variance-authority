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
import type { ExecutionIndex } from './reverse.js';

/**
 * `src/pick.ts` passes two callbacks to `find` on one line, so both regions
 * are `pick/find.arg0` at `entry` on line 2, told apart only by their place.
 * One test reaches the source and stops at the first callback; the other
 * reaches `build/pick.js`, a build whose map leads back to the source, and
 * falls through to the second. The two readings are joined into one record of
 * `src/pick.ts`, and each callback stays its own region there.
 */

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/same-line-vitest');
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;

let directory: string;
let pick: CoverageModule | undefined;
let cases: ExecutionIndex;

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-same-line-'));
  const coverageFile = resolve(directory, 'coverage.bin');
  await execute(process.execPath, [vitest, 'run', '--config', resolve(fixture, 'vitest.config.ts')], {
    cwd: fixture,
    env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
  });
  const written = await readFile(coverageFile);
  cases = decodeExecutionIndex(written);
  pick = decodeTestCoverage(written).modules.find((module) => module.file === named('src/pick.ts'));
}, 30_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('two callbacks on one line, read as source and as its build', () => {
  it('keeps both callbacks as regions, each with the tests that entered it', () => {
    const callbacks = pick?.blocks.filter((block) => block.name === 'pick/find.arg0');

    expect(callbacks?.map((block) => block.testFiles)).toEqual([
      [named('test/build.case.ts'), named('test/source.case.ts')],
      [named('test/build.case.ts')],
    ]);
  });

  it('keeps both callbacks in the case index, each with the cases that entered it', () => {
    const file = cases.modules.find((module) => module.file === named('src/pick.ts'));
    const callbacks = file?.blocks.filter((block) => block.name === 'pick/find.arg0');

    expect(callbacks?.map((block) => block.crossings.map((crossing) => cases.tests[crossing.test]!.name))).toEqual([
      ['falls back to an item that starts with it', 'finds the item itself'],
      ['falls back to an item that starts with it'],
    ]);
  });
});
