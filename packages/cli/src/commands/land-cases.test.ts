import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  caseSectionsAt,
  commitRunsFile,
  encodeExecutionIndex,
  lastCaseRunOf,
  readTestCoverage,
  RecordWithoutCoverage,
  recordOfCases,
  sharedRecord,
  testCoverageFile,
  withoutCoverage,
  writeTestCoverage,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import { readExecutionIndex, recordedExecutionFile } from './execution-input.js';
import { landJourneys } from './land.js';
import { probedModule, published, ranWhole, wholeRecord } from './mainline-fixture.js';

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

  it('lands over a record whose run instrumented nothing, folding over no coverage and keeping its cases', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    await writeFile(record, recordOfCases(caseSectionsAt(record)));
    const shard = join(home, 'shard-1.bin');
    await writeTestCoverage(shard, {
      version: 3,
      instrumentation: 'fixture',
      commit: first,
      tests: [{ file: 'test/total.test.ts', complete: false, preconditions: [] }],
      modules: [],
    });

    const landed = await landJourneys(dir, [shard], record);

    expect(landed.observations).toBe(1);
    expect(landed.cases).toEqual({ laid: record, shards: 0 });
    expect((await readExecutionIndex(record)).tests.map((test) => test.file)).toEqual(['test/total.test.ts']);
  });
});

describe('landJourneys and the run its shards were', () => {
  /** A case of `file` that said `user` was `value` in its body. */
  function said(file: string, name: string, value: string): ExecutionTest {
    return { id: `${file} > ${name}`, file, name, stopped: false, preconditions: [{ name: 'user', value, site: `${file}:2`, level: 65535 }] };
  }

  /** A shard at `commit` that finished `test`'s file, entered `src/total.ts`, and kept `test` as its one case. */
  async function casedShard(name: string, commit: string, test: ExecutionTest): Promise<string> {
    const shard = join(home, name);
    const block = { kind: 'function', name: 'applyDiscount', path: 'applyDiscount', startLine: 1, endLine: 3, source: true, crossings: [{ test: 0, distance: 0 }] };
    await writeTestCoverage(shard, {
      version: 3,
      instrumentation: 'fixture',
      commit,
      tests: [{ file: test.file, complete: true, preconditions: [] }],
      modules: [probedModule([test.file])],
    }, { index: encodeExecutionIndex({ tests: [test], modules: [{ file: 'src/total.ts', blocks: [block] }] }) });
    return shard;
  }

  it('names every case the shards ran as the last run, each with the preconditions it named', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    const discounts = said('test/total.test.ts', 'discounts', 'member');
    const alone = said('test/other.test.ts', 'stands alone', 'guest');
    const shards = [await casedShard('shard-1.bin', first, discounts), await casedShard('shard-2.bin', first, alone)];

    const landed = await landJourneys(dir, shards, record);

    expect(landed.cases).toEqual({ laid: record, shards: 2 });
    const last = lastCaseRunOf(caseSectionsAt(record))!;
    expect(last).toMatchObject({ commit: first, files: ['test/other.test.ts', 'test/total.test.ts'] });
    expect(last.cases).toEqual([alone.id, discounts.id]);
    const named = (await readExecutionIndex(record)).tests.filter((test) => last.cases.includes(test.id));
    expect(named.map((test) => [test.id, test.preconditions])).toEqual([[alone.id, alone.preconditions], [discounts.id, discounts.preconditions]]);
  });
});

describe('landJourneys and a shard whose run instrumented nothing', () => {
  /**
   * A shard at `commit` whose run finished `test/total.test.ts`, kept `index`
   * as its cases, and instrumented nothing: the record its seam writes, the
   * cases and the run that laid them, and no coverage.
   */
  async function uncoveredShard(commit: string, index: Uint8Array, name = 'shard-uncovered.bin'): Promise<string> {
    const shard = join(home, name);
    const last = { commit, at: '2026-01-01T00:00:00.000Z', files: ['test/total.test.ts'], began: true, cases: [] };
    await writeFile(shard, recordOfCases({ index, last: Buffer.from(JSON.stringify(last)) }));
    expect(withoutCoverage(shard)).toBe(true);
    return shard;
  }

  it('lays its cases over the record and leaves the coverage and the runs record as they were', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    await ranWhole(record, first);
    const before = await readTestCoverage(record);
    const runs = await readFile(commitRunsFile(record), 'utf8');
    const shard = await uncoveredShard(first, caseSectionsAt(record).index!);

    const landed = await landJourneys(dir, [shard], record);

    expect(landed.cases).toEqual({ laid: record, shards: 1 });
    expect(landed.observations).toBe(before.tests.length);
    expect(await readTestCoverage(record)).toEqual(before);
    expect(await readFile(commitRunsFile(record), 'utf8')).toBe(runs);
    const last = JSON.parse(Buffer.from(caseSectionsAt(record).last!).toString('utf8')) as { commit?: string; files: string[] };
    expect(last).toMatchObject({ commit: first, files: ['test/total.test.ts'] });
    expect((await readExecutionIndex(record)).tests.map((test) => test.file)).toEqual(['test/total.test.ts']);
  });

  it('writes a record of cases and no coverage where nothing was recorded, so it narrows nothing', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    const shard = await uncoveredShard(first, caseSectionsAt(record).index!);
    const into = join(home, 'landed.bin');

    const landed = await landJourneys(dir, [shard], into);

    expect(landed).toMatchObject({ at: into, shards: 1, observations: 0, modules: 0, cases: { laid: into, shards: 1 } });
    expect(withoutCoverage(into)).toBe(true);
    await expect(readTestCoverage(into)).rejects.toBeInstanceOf(RecordWithoutCoverage);
    await expect(stat(commitRunsFile(into))).rejects.toThrow();
    expect(caseSectionsAt(into).index).toBeDefined();
  });

  it('lays the cases of one that names no last run, for the files those cases are of', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    // A shard that crossed a checkout keeps its index and drops the run that wrote it.
    const shard = join(home, 'shard-shared.bin');
    await writeFile(shard, sharedRecord(await readFile(await uncoveredShard(first, caseSectionsAt(record).index!))));
    expect(caseSectionsAt(shard).last).toBeUndefined();

    const landed = await landJourneys(dir, [shard], record);

    expect(landed.cases).toEqual({ laid: record, shards: 1 });
    const last = JSON.parse(Buffer.from(caseSectionsAt(record).last!).toString('utf8')) as { commit?: string; files: string[] };
    expect(last.files).toEqual(['test/total.test.ts']);
    expect(last.commit).toBeUndefined();
  });

  it('lays nothing of one whose cases this build cannot read and that names no run, and keeps the record as it was', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    await ranWhole(record, first);
    const before = await readFile(record);
    // An index no version of this build spells, and nothing else: no coverage, no last run.
    const shard = join(home, 'shard-unreadable.bin');
    await writeFile(shard, recordOfCases({ index: Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]) }));
    expect(withoutCoverage(shard)).toBe(true);

    const landed = await landJourneys(dir, [shard], record);

    expect(landed.cases).toEqual({ laid: record, shards: 0 });
    expect(await readFile(record)).toEqual(before);
  });

  it('refuses shards whose runs name different commits, as a fold of measured ones does, and writes nothing', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    const before = await readFile(record);
    const index = caseSectionsAt(record).index!;
    const at = await uncoveredShard(first, index, 'shard-a.bin');
    const other = await uncoveredShard('b'.repeat(40), index, 'shard-b.bin');

    await expect(landJourneys(dir, [at, other], record)).rejects.toThrow(
      `${at} and ${other} disagree about the commit (\`${first}\` against \`${'b'.repeat(40)}\`), so they are not shards of one run and cannot be folded into one.`,
    );
    expect(await readFile(record)).toEqual(before);
  });

  it('folds the shards that measured something, and lays every shard\'s cases in the order they were named', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    const shard = await uncoveredShard(first, caseSectionsAt(record).index!);
    const measured = join(home, 'shard-measured.bin');
    await writeTestCoverage(measured, {
      version: 3,
      instrumentation: 'fixture',
      commit: first,
      tests: [{ file: 'test/other.test.ts', complete: false, preconditions: [] }],
      modules: [],
    });

    const landed = await landJourneys(dir, [shard, measured], record);

    expect(landed.shards).toBe(2);
    expect(landed.cases).toEqual({ laid: record, shards: 1 });
    expect((await readTestCoverage(record)).tests.map((test) => test.file)).toContain('test/other.test.ts');
  });
});
