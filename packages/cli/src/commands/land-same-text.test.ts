import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  encodeAsSetExecutionIndex,
  testCoverageFile,
  writeTestCoverage,
  type CoverageBlock,
  type ExecutionBlock,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import { readExecutionIndex } from './execution-input.js';
import { landJourneys } from './land.js';
import { published } from './mainline-fixture.js';

/**
 * A shard that cut one module's unchanged text into one region more than the
 * record it lands in holds.
 *
 * The cut depends on how a run read the file, not only on its text: a run that
 * loaded a module through both its source and its build keeps the regions both
 * readings cut alike, and a run that loaded it one way keeps all of that
 * reading's. So the mainline's whole run can hold `put` without its second
 * `await`, and a shard that loaded the file once holds it. The seats around it
 * are the same seats of the same text. The cases of every file the shard did not
 * run stay where they were, as the coverage rows beside them do.
 */

let home: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-land-same-text-')));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'cache');
});

afterEach(async () => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

const TEXT = 'source:total';
const TOTAL = 'test/total.test.ts';
const OTHER = 'test/other.test.ts';
const DISCOUNTS: ExecutionTest = { id: `${TOTAL} > discounts`, file: TOTAL, name: 'discounts', stopped: false };
const STANDS: ExecutionTest = { id: `${OTHER} > stands alone`, file: OTHER, name: 'stands alone', stopped: false };

type Region = Omit<ExecutionBlock, 'crossings'>;

const MODULE: Region = { kind: 'module', name: '', path: '', startLine: 1, endLine: 6, source: true };
const FIRST: Region = { kind: 'resume', name: 'put', path: 'await#0', startLine: 2, endLine: 2, source: true };
const SECOND: Region = { kind: 'resume', name: 'put', path: 'await#1', startLine: 3, endLine: 4, source: true };
const THIRD: Region = { kind: 'resume', name: 'put', path: 'await#2', startLine: 5, endLine: 5, source: true };

/** A record at `commit` of `src/total.ts`, read as `regions`, with `ran` as its one finished file and `cases` crossing `entered`. */
async function recordOf(
  path: string,
  commit: string,
  regions: readonly Region[],
  ran: string,
  cases: readonly ExecutionTest[],
  entered: readonly Region[],
): Promise<void> {
  const blocks = regions.map((region, ordinal): CoverageBlock => ({
    ...region,
    ordinal,
    ...(ordinal === 0 ? {} : { owner: 0 }),
    digest: `block:${region.path}`,
    testFiles: ordinal === 0 || entered.includes(region) ? [ran] : [],
  }));
  await writeTestCoverage(path, {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [{ file: ran, complete: true, preconditions: [] }],
    modules: [{ file: 'src/total.ts', sourceDigest: TEXT, instrumented: true, blocks }],
  }, {
    index: encodeAsSetExecutionIndex({
      tests: [...cases],
      modules: [{
        file: 'src/total.ts',
        blocks: regions.map((region) => ({
          ...region,
          crossings: entered.includes(region) ? cases.map((_, test) => ({ test, distance: 0 })) : [],
        })),
      }],
    }),
  });
}

/** The cases each region of `src/total.ts` holds in the record at `record`, by the region's path. */
async function casesByRegion(record: string): Promise<Record<string, string[]>> {
  const index = await readExecutionIndex(record);
  const module = index.modules.find((row) => row.file === 'src/total.ts')!;
  return Object.fromEntries(module.blocks
    .filter((block) => block.kind !== 'module')
    .map((block) => [block.path, block.crossings.map((crossing) => index.tests[crossing.test]!.id).sort()]));
}

describe('landJourneys and a shard that cut the same text into one region more', () => {
  it('keeps the cases of a file the shard did not run on the regions they entered', async () => {
    const { dir, first } = await published(home, { publish: false });
    const record = testCoverageFile(dir, { suite: 'unit' });
    // The mainline's run: both awaits it kept, entered by the case of `total`.
    await recordOf(record, first, [MODULE, FIRST, THIRD], TOTAL, [DISCOUNTS], [FIRST, THIRD]);
    // The shard ran `other` alone, read the file once, and kept the await between.
    const shard = join(home, 'shard-1.bin');
    await recordOf(shard, first, [MODULE, FIRST, SECOND, THIRD], OTHER, [STANDS], [SECOND]);

    await landJourneys(dir, [shard], record);

    expect(await casesByRegion(record)).toEqual({
      'await#0': [DISCOUNTS.id],
      'await#1': [STANDS.id],
      'await#2': [DISCOUNTS.id],
    });
  });
});
