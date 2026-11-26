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
  readonly attempts: number;
  /** The summed duration of every attempt before the last, in ms. */
  readonly lost: number;
}

/** What one record says of its run. */
export interface RecordSummary {
  /** Each test file and its duration in ms, null where the record keeps none. */
  readonly files: readonly (readonly [string, number | null])[];
  /** The sum of the known durations, in ms. */
  readonly total: number;
  /** The cases its per-case index holds; absent where it holds none. */
  readonly cases?: number;
  readonly retried: readonly RetriedCase[];
  /** Source files some test entered. */
  readonly reached: number;
}

/** One suite's record at one kept commit. */
export interface HistoryPoint extends RecordSummary {
  readonly commit: string;
  /** When the share kept it, in ms since the epoch. */
  readonly written: number;
  readonly suite: string;
}

/** The series, or why there is none. */
export type History = { readonly points: readonly HistoryPoint[]; readonly since: number } | { readonly unread: string };

const DAY = 86_400_000;
const MOVED = 20;
const MOVERS = 3;

/** The History tab of `history`. */
export function historyTab(history: History): Tab {
  if ('unread' in history) return { id: 'history', label: 'History', tables: () => [], facts: () => [['history', history.unread]] };
  const { points } = history;
  const commits = new Set(points.map((point) => point.commit)).size;
  return {
    id: 'history',
    label: 'History',
    facts: () => [
      ['window', `${Math.round(history.since / DAY)} days`],
      ['commits', commits],
      ['records', points.length],
      ['suites', [...new Set(points.map((point) => point.suite))].join(', ')],
    ],
    tables: () => [commitsTable(points), filesTable(points), retriedTable(points), movedTable(points)],
  };
}

function commitsTable(points: readonly HistoryPoint[]): Table {
  const table = listed(
    { id: 'history-commits', label: 'Commits', hint: 'each kept commit and suite, newest first' },
    ['commit', 'suite', 'ran', 'took', 'test files', 'cases', 'retried', 'lost', 'reached'],
    [...points]
      .sort((a, b) => b.written - a.written || codeUnitOrder(a.suite, b.suite))
      .map((point) => [point.commit, point.suite, point.written, point.total, point.files.length, point.cases, point.retried.length, sum(point.retried.map((one) => one.lost)), point.reached]),
  );
  return typed(table, { ran: 'time', took: 'ms', lost: 'ms' });
}

function filesTable(points: readonly HistoryPoint[]): Table {
  const files = new Map<string, { suite: string; file: string; runs: number; timed: number; took: number }>();
  for (const point of points) {
    for (const [file, took] of point.files) {
      const key = `${point.suite}\u0000${file}`;
      const held = files.get(key) ?? { suite: point.suite, file, runs: 0, timed: 0, took: 0 };
      held.runs += 1;
      if (took !== null) {
        held.timed += 1;
        held.took += took;
      }
      files.set(key, held);
    }
  }
  const rows = [...files.values()]
    .map((one) => ({ ...one, mean: one.timed === 0 ? undefined : Math.round(one.took / one.timed) }))
    .sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1) || codeUnitOrder(a.suite, b.suite) || codeUnitOrder(a.file, b.file));
  return typed(
    listed(
      { id: 'history-files', label: 'Test files', hint: 'each test file over the window, slowest mean first' },
      ['suite', 'test file', 'runs', 'mean', 'total'],
      rows.map((one) => [one.suite, one.file, one.runs, one.mean, one.took]),
    ),
    { mean: 'ms', total: 'ms' },
  );
}

function retriedTable(points: readonly HistoryPoint[]): Table {
  const cases = new Map<string, { suite: string; name: string; file?: string; commits: number; attempts: number; lost: number }>();
  for (const point of points) {
    for (const one of point.retried) {
      const key = `${point.suite}\u0000${one.case}`;
      const held = cases.get(key) ?? { suite: point.suite, name: one.name, ...(one.file === undefined ? {} : { file: one.file }), commits: 0, attempts: 0, lost: 0 };
      held.commits += 1;
      held.attempts += one.attempts;
      held.lost += one.lost;
      cases.set(key, held);
    }
  }
  const rows = [...cases.values()].sort((a, b) => b.lost - a.lost || b.commits - a.commits || codeUnitOrder(a.name, b.name));
  return typed(
    listed(
      { id: 'history-retried', label: 'Retried cases', hint: 'each case retried in the window, most time lost first' },
      ['suite', 'case', 'test file', 'commits', 'attempts', 'lost'],
      rows.map((one) => [one.suite, one.name, one.file, one.commits, one.attempts, one.lost]),
    ),
    { lost: 'ms' },
  );
}

/** A commit's suite time against the commit kept before it, and the test files that moved it most. */
export function movedOf(points: readonly HistoryPoint[]): readonly { readonly point: HistoryPoint; readonly before: HistoryPoint; readonly delta: number; readonly files: readonly (readonly [string, number])[] }[] {
  const bySuite = new Map<string, HistoryPoint[]>();
  for (const point of points) bySuite.set(point.suite, [...(bySuite.get(point.suite) ?? []), point]);
  const moved = [];
  for (const series of bySuite.values()) {
    series.sort((a, b) => a.written - b.written);
    for (let at = 1; at < series.length; at += 1) {
      const point = series[at]!;
      const before = series[at - 1]!;
      const was = new Map(before.files);
      const files = point.files
        .map(([file, took]) => [file, (took ?? 0) - (was.get(file) ?? 0)] as const)
        .filter(([, delta]) => delta !== 0)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || codeUnitOrder(a[0], b[0]))
        .slice(0, MOVERS);
      moved.push({ point, before, delta: point.total - before.total, files });
    }
  }
  return moved.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.point.written - a.point.written).slice(0, MOVED);
}

function movedTable(points: readonly HistoryPoint[]): Table {
  const signed = (ms: number) => `${ms > 0 ? '+' : ''}${ms} ms`;
  return typed(
    listed(
      { id: 'history-moved', label: 'Moved', hint: `the ${MOVED} commits whose suite time moved most from the commit kept before` },
      ['commit', 'suite', 'before', 'took', 'moved', 'test files that moved it'],
      movedOf(points).map((one): Cell[] => [one.point.commit, one.point.suite, one.before.commit, one.point.total, signed(one.delta), one.files.map(([file, delta]) => `${file} ${signed(delta)}`).join(', ')]),
    ),
    { took: 'ms' },
  );
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
