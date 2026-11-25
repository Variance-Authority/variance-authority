// compass: variance-authority.reach
/**
 * What `variance view` lays out: the recording's tests and timeline, cut to the
 * rows a page shows.
 *
 * Every figure is one a sense reader already holds: the CLI carries it and
 * cuts it to its top rows, and the page only sorts, filters and links. Nothing
 * here is timed or placed; a figure the runner did not report is absent, and a
 * recording that holds none says so beside the view it would have filled.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { recordedAttempts, recordedDurations, recordedTrace } from '@variance-authority/sense';
import type { RecordedAttempts, RecordedDurations, RecordedTrace, RetriedCase, TracedFile } from '@variance-authority/sense';
import { readRunRows } from '@variance-authority/sense/test-selection';
import type { FanIn, RunRow } from '@variance-authority/sense/test-selection';
import type { SourcesData } from './view-source.js';

/** How many rows of each kind the page holds. The recording keeps the rest. */
export const TOP = 100;

/**
 * The covering relation as the page draws it: read from the fan-in `coverage`
 * counted, so a file is entered the way coverage says it is, and both lists are
 * cut to `TOP` with the true count beside the cut.
 */
export interface ReachData {
  /** Each shown test file, with the source files its cases entered, the most-shared first. */
  readonly tests: readonly { readonly file: string; readonly reached: readonly string[]; readonly total: number }[];
  /** The source files the most test files entered, each with the test files that did. */
  readonly files: readonly { readonly file: string; readonly tests: readonly string[]; readonly total: number }[];
  /** Why the relation is empty, in words. */
  readonly note?: string;
}

/** What the Tests view holds. */
export interface TestsData {
  readonly slowestFiles: readonly { readonly file: string; readonly duration: number }[];
  readonly slowestCases: readonly { readonly file: string; readonly name: string; readonly duration: number; readonly limit?: number }[];
  readonly retried: readonly RetriedCase[];
  /** Every case the recording holds an attempt trail for that ended differently. */
  readonly differing: number;
  /** The retried cases no attempt of which passed, cut to `TOP`. */
  readonly unpassed: readonly RetriedCase[];
  /** Every retried case no attempt of which passed. */
  readonly unpassing: number;
  /** Why a half is empty, in words: a record that holds nothing there says so rather than reading as none. */
  readonly notes: readonly string[];
}

/** What the Timeline view holds: the files that carry a start, the slowest of them, on the runner's clock. */
export interface TimelineData {
  readonly files: readonly TracedFile[];
  /** Every file the recording holds, before any cut. */
  readonly recorded: number;
  /** Of those, the files that carry a start and a cost, before the cut to the slowest `TOP`. */
  readonly placed: number;
  /** Files the recording holds that the axis cannot place: no start, or no cost. */
  readonly unplaced: number;
  readonly note?: string;
}

/** What the Cadence view holds: one summary row for each run recorded, oldest first, over the weeks the record keeps. */
export interface CadenceData {
  readonly rows: readonly RunRow[];
}

/** The recording a page was cut from. */
export interface ViewData {
  readonly suite?: string;
  readonly commit?: string;
  readonly recording?: string;
  readonly tests: TestsData;
  readonly timeline: TimelineData;
  readonly cadence: CadenceData;
  readonly reach: ReachData;
  /** The text and range states of the files the Coverage tab can draw; `viewData` holds none, `viewSources` reads them. */
  readonly sources: SourcesData;
}

/** The slowest `TOP` files with a start, ordered by start so the page reads left to right. */
function placed(trace: Extract<RecordedTrace, { files: unknown }>): TimelineData {
  const starts = trace.files.filter((file) => file.start !== undefined && file.cost !== undefined);
  const kept = [...starts].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || codeUnitOrder(a.file, b.file)).slice(0, TOP);
  const files = kept.sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || codeUnitOrder(a.file, b.file));
  return {
    files,
    recorded: trace.files.length,
    placed: starts.length,
    unplaced: trace.files.length - starts.length,
    ...(files.length === 0 ? { note: 'no file in the recording has a start offset: record a Playwright run to place files on a clock' } : {}),
  };
}

function durationsOf(read: RecordedDurations | undefined, notes: string[]): Pick<TestsData, 'slowestFiles' | 'slowestCases'> {
  if (read === undefined) return { slowestFiles: [], slowestCases: [] };
  if ('unread' in read) {
    notes.push(`durations: ${read.unread}`);
    return { slowestFiles: [], slowestCases: [] };
  }
  const { cases } = read;
  if ('unread' in cases) notes.push(`cases: ${cases.unread}`);
  return { slowestFiles: read.slowest, slowestCases: 'unread' in cases ? [] : cases.slowest };
}

function retriedOf(read: RecordedAttempts | undefined, notes: string[]): { readonly retried: readonly RetriedCase[]; readonly differing: number; readonly unpassed: readonly RetriedCase[]; readonly unpassing: number } {
  if (read === undefined) return { retried: [], differing: 0, unpassed: [], unpassing: 0 };
  if ('unread' in read) {
    notes.push(`attempts: ${read.unread}`);
    return { retried: [], differing: 0, unpassed: [], unpassing: 0 };
  }
  if ('unkept' in read) {
    notes.push('attempts: the recording kept none, so a retried case cannot be told from one that ran once');
    return { retried: [], differing: 0, unpassed: [], unpassing: 0 };
  }
  return { retried: read.differed, differing: read.differing, unpassed: read.unpassed, unpassing: read.unpassing };
}

/** The suite asked for, or the first one that holds a recording. */
function pick<T extends { readonly suite?: string }>(rows: readonly T[], suite: string | undefined, readable: (row: T) => boolean): T | undefined {
  if (suite !== undefined) return rows.find((row) => row.suite === suite);
  return rows.find(readable) ?? rows[0];
}

/** The relation, read from the fan-in coverage counted, or the reason there is none. */
function reachFrom(fan: FanIn | { readonly missed: string } | undefined, shown: ReadonlySet<string>): ReachData {
  if (fan === undefined) return { tests: [], files: [], note: 'coverage counted no fan-in, so which test files entered a source file is not known' };
  if ('missed' in fan) return { tests: [], files: [], note: `coverage was not counted, so which test files entered a source file is not known: ${fan.missed}` };
  const entered = fan.files.filter((row) => (row.tests?.length ?? 0) > 0);
  const reached = new Map<string, string[]>();
  for (const row of entered) {
    for (const test of row.tests!) {
      if (!shown.has(test) || test === row.file) continue;
      const list = reached.get(test);
      if (list === undefined) reached.set(test, [row.file]);
      else list.push(row.file);
    }
  }
  const size = new Map(entered.map((row) => [row.file, row.tests!.length]));
  const tests = [...reached]
    .sort(([a], [b]) => codeUnitOrder(a, b))
    .map(([file, all]) => {
      all.sort((a, b) => size.get(b)! - size.get(a)! || codeUnitOrder(a, b));
      return { file, reached: all.slice(0, TOP), total: all.length };
    });
  const files = [...entered]
    .sort((a, b) => b.tests!.length - a.tests!.length || codeUnitOrder(a.file, b.file))
    .slice(0, TOP)
    .map((row) => ({ file: row.file, tests: row.tests!.slice(0, TOP), total: row.tests!.length }));
  return { tests, files };
}

/** The suite the page is about: the one asked for, or the first that holds a recording. */
export function viewSuite(root: string, suite?: string): string | undefined {
  return suite ?? pick(recordedDurations(root, TOP), undefined, (row) => !('unread' in row))?.suite;
}

/** The recording at `root` as the rows the page shows. */
export function viewData(root: string, suite?: string, fanIn?: FanIn | { readonly missed: string }): ViewData {
  const notes: string[] = [];
  const timed = pick(recordedDurations(root, TOP), suite, (row) => !('unread' in row));
  const attempts = pick(recordedAttempts(root, TOP), suite, (row) => !('unread' in row));
  const traced = recordedTrace(root, suite ?? timed?.suite);
  const tests: TestsData = { ...durationsOf(timed, notes), ...retriedOf(attempts, notes), notes };
  const timeline: TimelineData = 'unread' in traced ? { files: [], recorded: 0, placed: 0, unplaced: 0, note: traced.unread } : placed(traced);
  const shown = new Set([
    ...tests.slowestFiles.map((row) => row.file),
    ...tests.slowestCases.map((row) => row.file),
    ...tests.retried.map((row) => row.file),
    ...timeline.files.map((row) => row.file),
  ]);
  const reach = reachFrom(fanIn, shown);
  const commit = timed !== undefined && !('unread' in timed) ? timed.commit : undefined;
  return {
    ...(timed?.suite === undefined ? {} : { suite: timed.suite }),
    ...(commit === undefined ? {} : { commit }),
    ...(timed === undefined ? {} : { recording: timed.recording }),
    tests,
    timeline,
    cadence: { rows: timed === undefined ? [] : readRunRows(timed.recording) },
    reach,
    sources: { files: [], left: 0 },
  };
}
