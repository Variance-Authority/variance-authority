// compass: variance-authority.reach.crossings
/**
 * The History tab: every kept mainline record in the window, as one summary
 * per commit and suite, and what the window says across them.
 *
 * Browser safe: the page draws it from the summaries `variance view` carried,
 * and never sees a record of the series.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { listed, type Cell, type Table } from './view-rows.js';
import type { Tab } from './view-panes.js';

/** A retried case in one record, and what its earlier attempts cost. */
export interface RetriedCase {
  readonly case: string;
  readonly name: string;
  readonly file?: string;
  /** The summed duration of every attempt before the last, in ms. */
  readonly lost: number;
}

/** What one record says of its run. */
export interface RecordSummary {
  /** Each test file and what running it cost in ms, as sense's `costs` reads it; null where the record keeps no time. */
  readonly files: readonly (readonly [string, number | null])[];
  /** The sum of the known costs, in ms; absent where the runner timed no file. */
  readonly total?: number;
  /** The source files some test of the run reached. */
  readonly reached: number;
  /** The cases its per-case index holds; absent where it holds none. */
  readonly cases?: number;
  /** The cases retried; absent where the record kept no attempts. */
  readonly retried?: readonly RetriedCase[];
}

/** A point's suite time against the suite's point before, over the test files both timed. */
export interface Moved {
  readonly before: string;
  readonly delta: number;
  /** The files that moved it most, and by how much. */
  readonly files: readonly (readonly [string, number])[];
}

/** One suite's record at one kept commit. */
export interface HistoryPoint {
  readonly commit: string;
  /** When the share kept it, in ms since the epoch. */
  readonly written: number;
  readonly suite: string;
  readonly total?: number;
  readonly testFiles: number;
  readonly reached: number;
  readonly cases?: number;
  readonly retried?: readonly RetriedCase[];
  readonly moved?: Moved;
}

/** One test file across the window. */
export interface FileRuns {
  readonly suite: string;
  readonly file: string;
  /** The records that ran it. */
  readonly runs: number;
  /** The runs that kept a time for it. */
  readonly timed: number;
  /** Their summed time, in ms. */
  readonly took: number;
}

/** A kept record the series does not draw, and why. */
export interface Skipped {
  readonly commit: string;
  /** Absent where the whole commit could not be read. */
  readonly suite?: string;
  readonly why: string;
}

/** The series, or why there is none. */
export type History =
  | { readonly points: readonly HistoryPoint[]; readonly files: readonly FileRuns[]; readonly since: number; readonly skipped: readonly Skipped[] }
  | { readonly unread: string };

const DAY = 86_400_000;
const MOVED = 20;

/** The History tab of `history`. */
export function historyTab(history: History): Tab {
  if ('unread' in history) return { id: 'history', label: 'History', tables: () => [], facts: () => [['history', history.unread]] };
  const { points, skipped } = history;
  const commits = new Set(points.map((point) => point.commit)).size;
  return {
    id: 'history',
    label: 'History',
    facts: () => [
      ['window', `${Math.round(history.since / DAY)} days`],
      ['commits', commits],
      ['records', points.length],
      ['suites', [...new Set(points.map((point) => point.suite))].join(', ')],
      ...(points.some((point) => point.retried === undefined) ? [['retries', 'some records kept no attempts, so their retries are not known'] as const] : []),
      ...(skipped.length === 0 ? [] : [['not read', `${skipped.length} of ${skipped.length + points.length} records are not drawn; Not read says why`] as const]),
    ],
    tables: () => [commitsTable(points), filesTable(history.files), retriedTable(points), movedTable(points), ...(skipped.length === 0 ? [] : [skippedTable(skipped)])],
  };
}

function commitsTable(points: readonly HistoryPoint[]): Table {
  const table = listed(
    { id: 'history-commits', label: 'Commits', hint: 'each kept commit and suite, newest first' },
    ['commit', 'suite', 'ran', 'took', 'test files', 'files reached', 'cases', 'retried', 'lost'],
    [...points]
      .sort((a, b) => b.written - a.written || codeUnitOrder(a.suite, b.suite))
      .map((point) => [point.commit, point.suite, point.written, point.total, point.testFiles, point.reached, point.cases, point.retried?.length, point.retried === undefined ? undefined : sum(point.retried.map((one) => one.lost))]),
  );
  return typed(table, { ran: 'time', took: 'ms', lost: 'ms' });
}

function filesTable(files: readonly FileRuns[]): Table {
  const rows = files
    .map((one) => ({ ...one, mean: one.timed === 0 ? undefined : Math.round(one.took / one.timed) }))
    .sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1) || codeUnitOrder(a.suite, b.suite) || codeUnitOrder(a.file, b.file));
  return typed(
    listed(
      { id: 'history-files', label: 'Test files', hint: 'each test file over the window, slowest mean first' },
      ['suite', 'test file', 'runs', 'mean'],
      rows.map((one) => [one.suite, one.file, one.runs, one.mean]),
    ),
    { mean: 'ms' },
  );
}

function retriedTable(points: readonly HistoryPoint[]): Table {
  const cases = new Map<string, { suite: string; name: string; file?: string; commits: number; lost: number }>();
  for (const point of points) {
    for (const one of point.retried ?? []) {
      const key = `${point.suite}\u0000${one.case}`;
      const held = cases.get(key) ?? { suite: point.suite, name: one.name, ...(one.file === undefined ? {} : { file: one.file }), commits: 0, lost: 0 };
      held.commits += 1;
      held.lost += one.lost;
      cases.set(key, held);
    }
  }
  const rows = [...cases.values()].sort((a, b) => b.lost - a.lost || b.commits - a.commits || codeUnitOrder(a.name, b.name));
  return typed(
    listed(
      { id: 'history-retried', label: 'Retried cases', hint: 'each case retried in the window, most time lost first' },
      ['suite', 'case', 'test file', 'commits', 'lost'],
      rows.map((one) => [one.suite, one.name, one.file, one.commits, one.lost]),
    ),
    { lost: 'ms' },
  );
}

/** The points whose suite time moved most from the suite's point before. */
export function movedOf(points: readonly HistoryPoint[]): readonly (HistoryPoint & { readonly moved: Moved })[] {
  return points
    .filter((point): point is HistoryPoint & { readonly moved: Moved } => point.moved !== undefined)
    .sort((a, b) => Math.abs(b.moved.delta) - Math.abs(a.moved.delta) || b.written - a.written)
    .slice(0, MOVED);
}

function movedTable(points: readonly HistoryPoint[]): Table {
  const signed = (ms: number) => `${ms > 0 ? '+' : ''}${ms} ms`;
  return listed(
    { id: 'history-moved', label: 'Moved', hint: `the ${MOVED} commits whose suite time moved most from the commit kept before, over the test files both timed` },
    ['commit', 'suite', 'before', 'moved', 'test files that moved it'],
    movedOf(points).map((one): Cell[] => [one.commit, one.suite, one.moved.before, signed(one.moved.delta), one.moved.files.map(([file, delta]) => `${file} ${signed(delta)}`).join(', ')]),
  );
}

function skippedTable(skipped: readonly Skipped[]): Table {
  return listed({ id: 'history-skipped', label: 'Not read', hint: 'each kept record the series does not draw, and why' }, ['commit', 'suite', 'why'], skipped.map((one) => [one.commit, one.suite, one.why]));
}

function typed(table: Table, as: Readonly<Record<string, 'ms' | 'time'>>): Table {
  return {
    ...table,
    columns: table.columns.map((column) => {
      const kind = as[column.name];
      return kind === undefined ? column : { ...column, as: kind };
    }),
  };
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
