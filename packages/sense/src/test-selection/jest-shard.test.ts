import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { instrumentationId } from '../instrument/index.js';
import { CACHE_VARIABLE } from './cache-layers.js';
import { decodeTestCoverage } from './format.js';
import { mainlineReadRoot, testCoverageFile, writeFetchedMainline, writeTestCoverage } from './index.js';
import SelectionReporter from './jest-reporter.js';

const here = fileURLToPath(import.meta.url);
const repository = resolve(dirname(here), '../../../..');
const temporary: string[] = [];
const cacheBefore = process.env[CACHE_VARIABLE];

afterEach(async () => {
  if (cacheBefore === undefined) delete process.env[CACHE_VARIABLE];
  else process.env[CACHE_VARIABLE] = cacheBefore;
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * One Jest shard of this repository's `unit` suite, a suite given to the share,
 * recording into a cache of its own that holds a fetched mainline: what reading
 * the suite's times through the cli leaves there. It ran this file alone.
 */
async function shard(selected: boolean): Promise<readonly string[]> {
  const cache = await mkdtemp(resolve(tmpdir(), 'variance-authority-jest-shard-'));
  temporary.push(cache);
  process.env[CACHE_VARIABLE] = cache;
  const commit = 'a'.repeat(40);
  const fetched = resolve(mainlineReadRoot(cache, 'unit'), commit, 'coverage.bin');
  await mkdir(dirname(fetched), { recursive: true });
  await writeTestCoverage(fetched, {
    version: 3,
    instrumentation: instrumentationId('presence'),
    commit,
    tests: [{ file: 'elsewhere/only.test.ts', complete: true, preconditions: [] }],
    modules: [],
  });
  await writeFetchedMainline(cache, 'unit', { mainline: 'main', commit, fetched: new Date().toISOString() });
  const coverageFile = testCoverageFile(repository, { cacheRoot: cache, suite: 'unit' });

  const reporter = new SelectionReporter({ shard: { shardIndex: 1, shardCount: 2 } }, {
    root: repository,
    coverageFile,
    preconditions: [],
    ...(selected ? { selected: true } : {}),
  });
  reporter.onRunStart();
  await reporter.onRunComplete([], {
    testResults: [{ testFilePath: here, skipped: false, testResults: [{ status: 'passed' }] }],
  });
  return decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file).sort();
}

it('records the files a Jest shard ran and nothing else when its run selects nothing', async () => {
  expect(await shard(false)).toEqual(['packages/sense/src/test-selection/jest-shard.test.ts']);
});

it('records a selected Jest shard over the mainline it was laid on', async () => {
  expect(await shard(true)).toContain('elsewhere/only.test.ts');
});
