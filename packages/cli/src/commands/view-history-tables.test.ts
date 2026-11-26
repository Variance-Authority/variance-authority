// compass: variance-authority.reach.crossings
import { encodeTestCoverage, rawRecord } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { historyTab, movedOf, type HistoryPoint } from './view-history-tables.js';
import { panesOf } from './view-panes.js';
import { openRecord } from './view-record.js';
import type { Table } from './view-rows.js';

/** The History tab as the page draws it from the summaries `variance view` carried. */

const DAY = 86_400_000;
const [C1, C2, C3] = ['1', '2', '3'].map((digit) => digit.repeat(40)) as [string, string, string];

function point(commit: string, written: number, files: readonly (readonly [string, number | null])[], retried: HistoryPoint['retried'] = []): HistoryPoint {
  return { commit, written, suite: 'unit', files, total: files.reduce((sum, [, took]) => sum + (took ?? 0), 0), cases: 3, retried, reached: 2 };
}

const POINTS = [
  point(C1, 1 * DAY, [['test/a.test.ts', 10], ['test/pay.test.ts', 30]]),
  point(C2, 2 * DAY, [['test/a.test.ts', 10], ['test/pay.test.ts', 90]], [{ case: 'p', name: 'checkout > pays', file: 'test/pay.test.ts', attempts: 2, lost: 31 }]),
  point(C3, 3 * DAY, [['test/a.test.ts', 14], ['test/pay.test.ts', null]]),
];

const column = (table: Table, name: string): unknown[] => {
  const at = table.columns.find((held) => held.name === name)!;
  return Array.from({ length: table.count }, (_, row) => at.at(row));
};
const tables = () => new Map(historyTab({ points: POINTS, since: 14 * DAY }).tables().map((table) => [table.id, table]));

describe('the History tab', () => {
  it('lists each kept commit and suite, newest first, with its time, files, cases, retries and reach', () => {
    const commits = tables().get('history-commits')!;
    expect(column(commits, 'commit')).toEqual([C3, C2, C1]);
    expect(column(commits, 'took')).toEqual([14, 100, 40]);
    expect(column(commits, 'retried')).toEqual([0, 1, 0]);
    expect(column(commits, 'lost')).toEqual([0, 31, 0]);
    expect(column(commits, 'reached')).toEqual([2, 2, 2]);
  });

  it('gives each test file its runs and its mean over the runs that kept a time', () => {
    const files = tables().get('history-files')!;
    expect(column(files, 'test file')).toEqual(['test/pay.test.ts', 'test/a.test.ts']);
    expect(column(files, 'runs')).toEqual([3, 3]);
    expect(column(files, 'mean')).toEqual([60, 11]);
  });

  it('gives each retried case the commits it was retried on and the time lost', () => {
    const retried = tables().get('history-retried')!;
    expect(column(retried, 'case')).toEqual(['checkout > pays']);
    expect(column(retried, 'commits')).toEqual([1]);
    expect(column(retried, 'lost')).toEqual([31]);
  });

  it('names the commit whose suite time moved most from the one before, and the file that moved it', () => {
    const [most] = movedOf(POINTS);
    expect(most).toMatchObject({ point: { commit: C3 }, before: { commit: C2 }, delta: -86 });
    expect(movedOf(POINTS)[1]).toMatchObject({ point: { commit: C2 }, before: { commit: C1 }, delta: 60, files: [['test/pay.test.ts', 60]] });
  });

  it('says why, and draws no table, where there is no series', () => {
    const tab = historyTab({ unread: 'no share is configured, so no mainline record is kept' });
    expect(tab.tables()).toEqual([]);
    expect(tab.facts()).toEqual([['history', 'no share is configured, so no mainline record is kept']]);
  });
});

describe('the History tab among the panes', () => {
  const record = openRecord(rawRecord(encodeTestCoverage({ version: 3, instrumentation: 'fixture', tests: [{ file: 'a.test.ts', duration: 1, complete: true, preconditions: [] }], modules: [] })));

  it('sits just before the record tab, and leaves every other tab as it was', () => {
    const without = panesOf(record, 'unit').tabs.map(({ id }) => id);
    const unread = panesOf(record, 'unit', { unread: 'why' }).tabs.map(({ id }) => id);
    expect(unread).toEqual([...without.slice(0, -1), 'history', 'record']);
  });
});
