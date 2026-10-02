import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTestCoverage, testCoverageFile } from '@variance-authority/sense/test-selection';
import { published, ranHere } from './mainline-fixture.js';

/**
 * The records the mainline fixture writes are records a reader reads whole,
 * not only the views selection opens: a test that reads one through
 * `readTestCoverage` reads what CI would have written.
 */

let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-mainline-fixture-')));
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'cache'));
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

/** Each module's regions as ordinal, owner, kind, name and the test files that entered it, in ordinal order. */
async function regionsAt(dir: string) {
  const coverage = await readTestCoverage(testCoverageFile(dir, { suite: 'unit' }));
  return coverage.modules.map((module) => [
    module.file,
    module.blocks.map((block) => [block.ordinal, block.owner, block.kind, block.name, block.testFiles]),
  ]);
}

/** `src/total.ts` as a run records it: the module region, and `applyDiscount` inside it. */
const TOTAL_REGIONS = [
  ['src/total.ts', [
    [0, undefined, 'module', '', ['test/total.test.ts']],
    [1, 0, 'function', 'applyDiscount', ['test/total.test.ts']],
  ]],
];

describe('the mainline fixture\'s records', () => {
  it('reads whole the record CI makes, its module opening on a module region that holds `applyDiscount`', async () => {
    const { dir } = await published(home, { publish: false });

    expect(await regionsAt(dir)).toEqual(TOTAL_REGIONS);
  });

  it('reads whole the record a run over a change makes', async () => {
    const { dir } = await published(home, { publish: false });
    await ranHere(dir, 'b'.repeat(40));

    expect(await regionsAt(dir)).toEqual(TOTAL_REGIONS);
  });
});
