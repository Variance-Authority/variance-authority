import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseSectionsAt, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { readExecutionIndex, recordedExecutionFile } from './execution-input.js';
import { landJourneys } from './land.js';
import { published, wholeRecord } from './mainline-fixture.js';

/**
 * The cases in the record a landing writes, in the primary checkout: the ones
 * a local run kept there, with a shard that re-recorded one of its files landed
 * over them.
 */

let home: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-land-cases-')));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'cache');
});

afterEach(async () => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

describe('landJourneys and the cases in the record', () => {
  it('drops the cases a shard replaced without keeping its own, so a reader says nothing is recorded', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    // The cases already recorded: a case of `test/total.test.ts` runs `applyDiscount`.
    expect((await readExecutionIndex(record)).tests.map((test) => test.file)).toEqual(['test/total.test.ts']);
    const shard = join(home, 'shard-1.bin');
    await writeTestCoverage(shard, {
      version: 3,
      instrumentation: 'fixture',
      commit: first,
      tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
      modules: [],
    });

    const landed = await landJourneys(dir, [shard], record);

    // The snapshot now says `test/total.test.ts` runs nothing in `src/total.ts`,
    // and the index already there says one of its cases runs `applyDiscount`.
    expect(caseSectionsAt(record)).toEqual({});
    await expect(recordedExecutionFile(dir, 'unit')).rejects.toMatchObject({ kind: 'unrecorded' });
    expect(landed.cases).toEqual({ unanswered: record, shard, removed: true });
  });

  it('leaves the cases as they were when no shard finished a test file', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    const shard = join(home, 'shard-1.bin');
    await writeTestCoverage(shard, {
      version: 3,
      instrumentation: 'fixture',
      commit: first,
      tests: [{ file: 'test/total.test.ts', complete: false, preconditions: [] }],
      modules: [],
    });

    const landed = await landJourneys(dir, [shard], record);

    expect(landed.cases).toEqual({ laid: record, shards: 0 });
    expect((await readExecutionIndex(record)).tests.map((test) => test.file)).toEqual(['test/total.test.ts']);
  });
});
