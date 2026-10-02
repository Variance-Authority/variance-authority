import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  encodeAsSetExecutionIndex,
  readTestCoverage,
  recordedEyesAt,
  writeTestCoverage,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import { readExecutionIndex } from './execution-input.js';
import { landJourneys } from './land.js';
import { published, wholeRecord } from './mainline-fixture.js';

/**
 * A shard's attribution lands whole: the regions it covered, the conditions
 * each case said it ran under, and the Eyes journals each case handed over, all
 * three in the record the landing writes. Two shards of one run each hold all
 * three, for a test file of their own, and are landed the way `variance
 * journeys --suite` lands them.
 */

let home: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-attribution-lands-')));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'cache');
});

afterEach(async () => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

const TOTAL = 'test/total.test.ts';
const OTHER = 'test/other.test.ts';
const MOCKED = { name: 'network', value: 'mocked', site: `${TOTAL}:2`, level: 1 };
const FLAGGED = { name: 'flag', value: 'ff-on', site: `${OTHER}:1`, level: 0xffff };
const DISCOUNTS: ExecutionTest = { id: `${TOTAL} > discounts`, file: TOTAL, name: 'discounts', preconditions: [MOCKED] };
const STANDS: ExecutionTest = { id: `${OTHER} > stands alone`, file: OTHER, name: 'stands alone', preconditions: [FLAGGED] };
const journal = (by: string) => ({ complete: true, attention: [], by });

/** A shard of the run at `commit` that ran `test` alone: its coverage of `src/total.ts`, its case, and that case's journal. */
async function shardOf(commit: string, test: ExecutionTest, name: string): Promise<string> {
  const path = join(home, name);
  await writeTestCoverage(path, {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [{ file: test.file, complete: true, preconditions: [] }],
    modules: [{
      file: 'src/total.ts',
      sourceDigest: 'source:total',
      instrumented: true,
      blocks: [{
        ordinal: 0, kind: 'module', digest: 'block:0', name: 'total', path: 'module',
        startLine: 1, endLine: 3, source: true, testFiles: [test.file],
      }],
    }],
  }, {
    index: encodeAsSetExecutionIndex({
      tests: [test],
      modules: [{
        file: 'src/total.ts',
        blocks: [{ kind: 'module', name: 'total', path: 'module', startLine: 1, endLine: 3, source: true, crossings: [{ test: 0, distance: 0 }] }],
      }],
    }),
    eyes: Buffer.from(`${JSON.stringify({ version: 1, watched: [test.id], journals: [{ case: test.id, attempt: 1, journal: journal(name) }] })}\n`),
  });
  return path;
}

describe('landJourneys and every kind of attribution a shard holds', () => {
  it('lands each shard\'s regions, case preconditions and Eyes journals into the one record', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const shards = [await shardOf(first, DISCOUNTS, 'shard-a.bin'), await shardOf(first, STANDS, 'shard-b.bin')];
    const record = join(home, 'landed.bin');

    const landed = await landJourneys(dir, shards, record);

    expect(landed.cases).toEqual({ laid: record, shards: 2 });
    const coverage = await readTestCoverage(record);
    expect(coverage.tests.map((test) => test.file)).toEqual([OTHER, TOTAL]);
    expect(coverage.modules.flatMap((module) => module.blocks.map((block) => [module.file, block.testFiles]))).toEqual([
      ['src/total.ts', [OTHER, TOTAL]],
    ]);
    const index = await readExecutionIndex(record);
    expect(index.tests.map((test) => [test.id, test.preconditions])).toEqual([
      [STANDS.id, [FLAGGED]],
      [DISCOUNTS.id, [MOCKED]],
    ]);
    expect(index.modules.flatMap((module) => module.blocks.map((block) => block.crossings.map(({ test }) => index.tests[test]!.id).sort())))
      .toEqual([[STANDS.id, DISCOUNTS.id].sort()]);
    expect(recordedEyesAt(record)).toEqual({
      watched: [STANDS.id, DISCOUNTS.id],
      journals: [
        { case: STANDS.id, attempt: 1, journal: journal('shard-b.bin') },
        { case: DISCOUNTS.id, attempt: 1, journal: journal('shard-a.bin') },
      ],
    });
  });
});
