import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  caseSectionsAt,
  commitRunsFile,
  encodeAsSetExecutionIndex,
  encodeExecutionIndex,
  lastCaseRunOf,
  readTestCoverage,
  RecordWithoutCoverage,
  recordOfCases,
  rowOf,
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
    expect(caseSectionsAt(record)).toEqual({ base: expect.any(Uint8Array) });
    await expect(recordedExecutionFile(dir, 'unit')).rejects.toMatchObject({ kind: 'unrecorded' });
    expect(landed.cases).toEqual({ unanswered: record, shards: [shard], removed: true });
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
    return { id: `${file} > ${name}`, file, name, stopped: false, said: JSON.stringify({ said: [['auth:user', JSON.stringify(value), `${file}:2`, 65535]] }) };
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
    }, { index: encodeAsSetExecutionIndex({ tests: [test], modules: [{ file: 'src/total.ts', blocks: [block] }] }) });
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
    expect(named.map((test) => [test.id, rowOf(test)])).toEqual([
      [alone.id, [{ name: 'auth:user', value: 'guest', site: 'test/other.test.ts:2', level: 65535 }]],
      [discounts.id, [{ name: 'auth:user', value: 'member', site: 'test/total.test.ts:2', level: 65535 }]],
    ]);
  });

  it('counts the shards whose cases it laid, and not an empty one named beside them', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    const cased = await casedShard('shard-1.bin', first, said('test/total.test.ts', 'discounts', 'member'));
    // A shard job that ran no test writes a record that observed nothing.
    const empty = join(home, 'shard-2.bin');
    await writeTestCoverage(empty, { version: 3, instrumentation: 'fixture', commit: first, tests: [], modules: [] });

    const landed = await landJourneys(dir, [cased, empty], record);

    expect(landed).toMatchObject({ shards: 2, cases: { laid: record, shards: 1 } });
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
    await writeFile(shard, recordOfCases({ index, last: Buffer.from(JSON.stringify(last)), base: Buffer.from('none') }));
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
    const { dir } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    // A shard that keeps its index and names no run that wrote it, as one that crossed a checkout does.
    const shard = join(home, 'shard-shared.bin');
    await writeFile(shard, recordOfCases({ index: caseSectionsAt(record).index!, base: Buffer.from('none') }));
    expect(caseSectionsAt(shard).last).toBeUndefined();

    const landed = await landJourneys(dir, [shard], record);

    expect(landed.cases).toEqual({ laid: record, shards: 1 });
    const last = JSON.parse(Buffer.from(caseSectionsAt(record).last!).toString('utf8')) as { commit?: string; files: string[] };
    expect(last.files).toEqual(['test/total.test.ts']);
    expect(last.commit).toBeUndefined();
  });

  it('names the commit the record it lands over stands at as the before layer\'s, when that record crossed and names no run', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    await ranWhole(record, first);
    const index = caseSectionsAt(record).index!;
    // The mainline's record as its own landing left it, then crossed, as the CI record job lays it: it names no last run.
    await landJourneys(dir, [await uncoveredShard(first, index, 'shard-main.bin')], record);
    await writeFile(record, sharedRecord(await readFile(record)));
    expect(caseSectionsAt(record).last).toBeUndefined();
    const later = 'c'.repeat(40);

    await landJourneys(dir, [await uncoveredShard(later, index, 'shard-change.bin')], record);

    const last = JSON.parse(Buffer.from(caseSectionsAt(record).last!).toString('utf8')) as { commit?: string; before?: string };
    expect(last).toMatchObject({ commit: later, before: first });
  });

  it('refuses one whose cases this build cannot read, by name, and keeps the record as it was', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    await ranWhole(record, first);
    const before = await readFile(record);
    // An index no version of this build spells, and nothing else but the base: no coverage, no last run.
    const shard = join(home, 'shard-unreadable.bin');
    await writeFile(shard, recordOfCases({ index: Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), base: Buffer.from('none') }));
    expect(withoutCoverage(shard)).toBe(true);

    await expect(landJourneys(dir, [shard], record)).rejects.toThrow(`cannot read the case index of ${shard}`);
    expect(await readFile(record)).toEqual(before);
  });

  it('refuses one whose case index is at another version, by name', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    await ranWhole(record, first);
    const before = await readFile(record);
    // An index at another version: one row per case and region.
    const rows = encodeExecutionIndex(await readExecutionIndex(record));
    const shard = await uncoveredShard(first, rows, 'shard-rows.bin');

    await expect(landJourneys(dir, [shard], record)).rejects.toThrow(
      new RegExp(`cannot read the case index of ${shard}: .*it is written at version 5, and this build reads version 3$`),
    );
    expect(await readFile(record)).toEqual(before);
  });

  it('refuses one test file whose cases two shards ran, naming both, and writes nothing', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    const before = await readFile(record);
    const index = caseSectionsAt(record).index!;
    const at = await uncoveredShard(first, index, 'shard-a.bin');
    const again = await uncoveredShard(first, index, 'shard-b.bin');

    await expect(landJourneys(dir, [at, again], record)).rejects.toThrow(
      /`test\/total\.test\.ts` has cases in .*shard-[ab]\.bin and again in .*shard-[ab]\.bin\. A test file belongs to one shard/,
    );
    expect(await readFile(record)).toEqual(before);
  });

  it('fails when the shards started from different commits, as a fold of measured ones does, and writes nothing', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    const before = await readFile(record);
    const index = caseSectionsAt(record).index!;
    const at = await uncoveredShard(first, index, 'shard-a.bin');
    const other = await uncoveredShard('b'.repeat(40), index, 'shard-b.bin');

    // The combine hears the shards in code-unit order of their paths, whatever order they are named in.
    await expect(landJourneys(dir, [other, at], record)).rejects.toThrow(new Error(
      `the build failed because the sharding was unstable: ${at} started from commit \`${first}\`, and ${other} from commit \`${'b'.repeat(40)}\`. ` +
        'Each shard split the suite against the record it started from, so the split may have left tests that ran in no shard. ' +
        'Nothing of this build is combined, so the record before it stands. ' +
        'Shards start alike when every one restores the same cached record: ' +
        'the `actions/cache` step keyed `variance-${{ runner.os }}-${{ runner.arch }}-${{ github.sha }}` restores it, ' +
        'and a shard that restored another, or none, starts apart.',
    ));
    expect(await readFile(record)).toEqual(before);
  });

  it('refuses a shard that kept cases beside one that kept none, as no one run keeps cases of only some files', async () => {
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

    const before = await readFile(record);

    await expect(landJourneys(dir, [shard, measured], record)).rejects.toThrow(/kept cases and .* kept none/);
    expect(await readFile(record)).toEqual(before);
  });
});
