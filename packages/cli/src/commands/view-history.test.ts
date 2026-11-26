// compass: variance-authority.reach.crossings
import { mkdtempSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryLineCell, publishLine, type LineCell, type ShareEntry } from '@variance-authority/core/share';
import { encodeTestCoverage, withCaseSections } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
// Sense publishes the readers of attempts and of the case index and not their
// writers, which only a recording run calls, so this writes a record the way
// that run does.
import { encodeRecordedAttempts } from '../../../sense/src/test-selection/attempts-record.js';
import { encodeAsSetExecutionIndex } from '../../../sense/src/test-selection/execution-set-format.js';
import { frame } from '../share-entries.js';
import { historyOf, summaryOf } from './view-history.js';

/**
 * The run series `variance view` draws: every mainline record the share keeps
 * at a commit in the window, each read whole and summarised once.
 */

const DAY = 86_400_000;
const NOW = 1_900_000_000_000;
const [C0, C1, C2, C3] = ['0', '1', '2', '3'].map((digit) => digit.repeat(40)) as [string, string, string, string];
const MAIN = { kind: 'mainline', name: 'main' } as const;
/** The mainline's first-parent history as git walks it, oldest first. */
const IN_GIT = async (kept: ReadonlySet<string>) => [C0, C1, C2, C3].filter((commit) => kept.has(commit));

/** A record of two test files, the second's cases with one retried once. */
function record(durations: readonly [number, number], options: { readonly retried?: boolean; readonly stray?: boolean; readonly untimed?: boolean; readonly gap?: boolean } = {}): Uint8Array {
  const coverage = encodeTestCoverage({
    version: 3,
    instrumentation: 'fixture',
    tests: [
      { file: 'test/a.test.ts', duration: durations[0], complete: true, preconditions: [] },
      { file: 'test/pay.test.ts', duration: durations[1], complete: true, preconditions: [] },
    ],
    modules: [
      { file: 'src/a.ts', sourceDigest: 'a', instrumented: true, blocks: [{ ordinal: 0, kind: 'module', digest: 'a', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: ['test/a.test.ts'] }] },
      { file: 'src/pay.ts', sourceDigest: 'p', instrumented: true, blocks: [{ ordinal: 0, kind: 'module', digest: 'p', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: ['test/pay.test.ts'] }] },
      { file: 'src/idle.ts', sourceDigest: 'i', instrumented: true, blocks: [{ ordinal: 0, kind: 'module', digest: 'i', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: [] }] },
    ],
  });
  return withCaseSections(coverage, {
    index: encodeAsSetExecutionIndex({
      tests: [
        { id: 'a', file: 'test/a.test.ts', name: 'adds', duration: 3 },
        { id: 'p', file: 'test/pay.test.ts', name: 'checkout > pays', duration: 40 },
        { id: 'r', file: 'test/pay.test.ts', name: 'checkout > refunds', duration: 9 },
      ],
      modules: [],
    }),
    ...(options.retried === true
      ? { attempts: encodeRecordedAttempts([
          options.untimed === true ? { case: 'p', attempt: 1, ended: 'failed' } as const : { case: 'p', attempt: 1, ended: 'failed', duration: 31 } as const,
          { case: 'p', attempt: options.gap === true ? 3 : 2, ended: 'passed', duration: 8 },
          ...(options.stray === true ? [{ case: 'gone', attempt: 1, ended: 'failed', duration: 5 } as const, { case: 'gone', attempt: 2, ended: 'passed', duration: 5 } as const] : []),
        ]) }
      : {}),
  });
}

function entry(commit: string, bytes: Uint8Array, suite = 'unit'): ShareEntry {
  return { name: `suite-v1/${suite}`, commit, bytes: frame([['coverage.bin', bytes]]) };
}

/** A share whose mainline was published at each commit, `ago` days before now. */
async function kept(published: readonly { readonly commit: string; readonly ago: number; readonly entries: readonly ShareEntry[] }[]) {
  let clock = 0;
  const cell = memoryLineCell(() => clock);
  for (const one of published) {
    clock = NOW - one.ago * DAY;
    await publishLine(cell, MAIN, one.entries, { descends: async () => false, image: async () => new Uint8Array() });
  }
  let reads = 0;
  const counted: LineCell = {
    ...cell,
    load: async (line) => { reads += 1; return cell.load(line); },
    blob: async (line, path) => { reads += 1; return cell.blob(line, path); },
  };
  return { cell: counted, reads: () => reads };
}

const cache = () => mkdtempSync(join(tmpdir(), 'va-history-'));

describe('one record, summarised', () => {
  it('gives each test file and its time, the source files its tests reached, the cases, and the retried case and its earlier attempt\'s time', () => {
    expect(summaryOf(record([12, 30], { retried: true }))).toEqual({
      files: [['test/a.test.ts', 12], ['test/pay.test.ts', 30]],
      total: 42,
      reached: 2,
      cases: 3,
      retried: [{ name: 'checkout > pays', file: 'test/pay.test.ts', lost: 31 }],
    });
  });

  it('refuses a record whose attempts name a case it does not hold, as sense does', () => {
    expect(() => summaryOf(record([12, 30], { retried: true, stray: true }))).toThrow(/a case the record does not hold: gone/u);
  });

  it('says nothing of the time lost where an earlier attempt kept no time, rather than counting it as none', () => {
    expect(summaryOf(record([12, 30], { retried: true, untimed: true })).retried).toEqual([{ name: 'checkout > pays', file: 'test/pay.test.ts' }]);
  });

  it('says nothing of the time lost where an earlier attempt left no row, rather than counting it as none', () => {
    expect(summaryOf(record([12, 30], { retried: true, gap: true })).retried).toEqual([{ name: 'checkout > pays', file: 'test/pay.test.ts' }]);
  });

  it('says nothing of retries where the record kept no attempts', () => {
    expect(summaryOf(record([12, 30]))).not.toHaveProperty('retried');
  });
});

describe('the kept commits, as a series', () => {
  it('reads every commit in the window, one point per suite, and leaves one outside it unread', async () => {
    const { cell } = await kept([
      { commit: C0, ago: 20, entries: [entry(C0, record([1, 1]))] },
      { commit: C1, ago: 3, entries: [entry(C1, record([10, 30])), entry(C1, record([5, 5]), 'chromium')] },
      { commit: C2, ago: 2, entries: [entry(C2, record([10, 90], { retried: true }))] },
      { commit: C3, ago: 1, entries: [entry(C3, record([12, 30]))] },
    ]);

    const history = await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir: cache(), order: IN_GIT });

    expect('points' in history && history.points.map(({ commit, suite, total, written }) => [commit, suite, total, written])).toEqual([
      [C1, 'chromium', 10, NOW - 3 * DAY],
      [C1, 'unit', 40, NOW - 3 * DAY],
      [C2, 'unit', 100, NOW - 2 * DAY],
      [C3, 'unit', 42, NOW - DAY],
    ]);
  });

  it('reads nothing but the listing the second time: each commit\'s manifest and each record\'s summary are kept', async () => {
    const { cell, reads } = await kept([
      { commit: C1, ago: 2, entries: [entry(C1, record([10, 30]))] },
      { commit: C2, ago: 1, entries: [entry(C2, record([10, 90]))] },
    ]);
    const cacheDir = cache();
    const first = await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir, order: IN_GIT });
    const before = reads();

    const second = await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir, order: IN_GIT });

    expect(second).toEqual(first);
    expect(before).toBeGreaterThan(0);
    expect(reads()).toBe(before);
  });

  it('marks what it held as opened, so a cache sweep by age keeps what a window still reads', async () => {
    const { cell } = await kept([{ commit: C1, ago: 2, entries: [entry(C1, record([10, 30]))] }]);
    const cacheDir = cache();
    await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir, order: IN_GIT });
    const held = readdirSync(join(cacheDir, 'history')).map((name) => join(cacheDir, 'history', name));
    const old = new Date(Date.now() - 30 * DAY);
    for (const path of held) utimesSync(path, old, old);

    await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir, order: IN_GIT });

    expect(held.length).toBeGreaterThan(0);
    expect(held.filter((path) => statSync(path).mtimeMs < Date.now() - DAY)).toEqual([]);
  });

  it('says how many commits it reads and how far it has got, and says nothing of what it held', async () => {
    const { cell } = await kept([
      { commit: C1, ago: 2, entries: [entry(C1, record([10, 30]))] },
      { commit: C2, ago: 1, entries: [entry(C2, record([10, 90]))] },
    ]);
    const cacheDir = cache();
    const said: string[] = [];

    await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir, order: IN_GIT, progress: (line) => said.push(line) });
    const warm: string[] = [];
    await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir, order: IN_GIT, progress: (line) => warm.push(line) });

    expect(said).toEqual(['reading 2 commits kept on main in the last 14 days', 'read 1 of 2', 'read 2 of 2']);
    expect(warm).toEqual([]);
  });

  it('says why where the share keeps no commit in the window, and where it cannot list them', async () => {
    const { cell } = await kept([{ commit: C0, ago: 20, entries: [entry(C0, record([1, 1]))] }]);

    expect(await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir: cache(), order: IN_GIT })).toEqual({ unread: 'the share keeps no record of main from the last 14 days' });
    expect(await historyOf({ ...cell, commits: undefined }, 'main', { since: 14 * DAY, now: NOW, cacheDir: cache(), order: IN_GIT })).toEqual({ unread: 'the share keeps only the latest record of each line, so it holds no series' });
    const unlisted: LineCell = { ...cell, commits: async () => ({ kind: 'unreachable', detail: 'timed out' }) };
    expect(await historyOf(unlisted, 'main', { since: 14 * DAY, now: NOW, cacheDir: cache(), order: IN_GIT })).toMatchObject({ unread: expect.stringMatching(/^the share could not list the commits it keeps: /u) });
  });

  it('names a record it cannot open, and why, and draws the rest', async () => {
    const { cell } = await kept([
      { commit: C1, ago: 2, entries: [entry(C1, record([10, 30]))] },
      { commit: C2, ago: 1, entries: [entry(C2, new Uint8Array([1, 2, 3]))] },
    ]);

    const history = await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir: cache(), order: IN_GIT });

    expect(history).toMatchObject({ skipped: [{ commit: C2, suite: 'unit', why: expect.any(String) }] });
    expect('points' in history && history.points.map(({ commit }) => commit)).toEqual([C1]);
  });

  it('reads a commit again where a record it names could not be read, and where the share wrote it again', async () => {
    const { cell, reads } = await kept([{ commit: C1, ago: 2, entries: [entry(C1, new Uint8Array([1, 2, 3]))] }]);
    const cacheDir = cache();
    await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir, order: IN_GIT });
    const before = reads();

    await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir, order: IN_GIT });

    expect(reads()).toBeGreaterThan(before);
  });

  it('says nothing of a total where the runner timed no test file', () => {
    expect(summaryOf(record([NaN, NaN]))).not.toHaveProperty('total');
  });

  it('says nothing of a total where the runner timed some test files and not others, rather than a partial sum as the suite\'s', () => {
    expect(summaryOf(record([12, NaN]))).not.toHaveProperty('total');
  });

  it('moves nothing across a record it could not read: the commit after it is not measured from the one before it', async () => {
    const { cell } = await kept([
      { commit: C1, ago: 3, entries: [entry(C1, record([10, 30]))] },
      { commit: C2, ago: 2, entries: [entry(C2, new Uint8Array([1, 2, 3]))] },
      { commit: C3, ago: 1, entries: [entry(C3, record([10, 90]))] },
    ]);

    const history = await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir: cache(), order: IN_GIT });

    expect('points' in history && history.points.map((point) => [point.commit, point.moved])).toEqual([
      [C1, undefined],
      [C3, undefined],
    ]);
  });

  it('carries each test file once for the window, and each point its move from the one before', async () => {
    const { cell } = await kept([
      { commit: C1, ago: 2, entries: [entry(C1, record([10, 30]))] },
      { commit: C2, ago: 1, entries: [entry(C2, record([10, 90]))] },
    ]);

    const history = await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir: cache(), order: IN_GIT });

    expect('points' in history && history.files).toEqual([
      { suite: 'unit', file: 'test/a.test.ts', runs: 2, timed: 2, took: 20 },
      { suite: 'unit', file: 'test/pay.test.ts', runs: 2, timed: 2, took: 120 },
    ]);
    expect('points' in history && history.points.map((point) => [point.testFiles, point.moved])).toEqual([
      [2, undefined],
      [2, { before: C1, delta: 60, files: [['test/pay.test.ts', 60]] }],
    ]);
  });

  it('moves each commit from the one git puts before it, not the one the share wrote before it', async () => {
    const { cell } = await kept([
      { commit: C1, ago: 3, entries: [entry(C1, record([10, 30]))] },
      { commit: C3, ago: 2, entries: [entry(C3, record([10, 50]))] },
      { commit: C2, ago: 1, entries: [entry(C2, record([10, 90]))] },
    ]);

    const history = await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir: cache(), order: IN_GIT });

    expect('points' in history && history.points.map((point) => [point.commit, point.moved?.before, point.moved?.delta])).toEqual([
      [C1, undefined, undefined],
      [C3, C2, -40],
      [C2, C1, 60],
    ]);
  });

  it('draws a commit git does not place on the mainline, moves nothing by it, and counts it', async () => {
    const { cell } = await kept([
      { commit: C1, ago: 3, entries: [entry(C1, record([10, 30]))] },
      { commit: C2, ago: 2, entries: [entry(C2, record([10, 90]))] },
      { commit: C3, ago: 1, entries: [entry(C3, record([10, 50]))] },
    ]);

    const history = await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir: cache(), order: async () => [C1, C3] });

    expect('points' in history && [history.points.map((point) => [point.commit, point.moved?.before]), history.unplaced]).toEqual([
      [[C1, undefined], [C2, undefined], [C3, C1]],
      1,
    ]);
  });

  it('names a partial run as not read, and draws none of it', async () => {
    const { cell } = await kept([
      { commit: C1, ago: 2, entries: [entry(C1, record([10, 30]))] },
      { commit: C2, ago: 1, entries: [{ ...entry(C2, record([10, 90])), partial: true }] },
    ]);

    const history = await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir: cache(), order: IN_GIT });

    expect('points' in history && [history.points.map(({ commit }) => commit), history.skipped]).toEqual([
      [C1],
      [{ commit: C2, suite: 'unit', why: 'a partial run: it holds only the tests it ran' }],
    ]);
  });
});
