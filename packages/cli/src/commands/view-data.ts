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

import { recordedAttempts, recordedDurations, recordedTrace } from '@variance-authority/sense';
import type { RecordedAttempts, RecordedDurations, RecordedTrace, RetriedCase, TracedFile } from '@variance-authority/sense';

/** How many rows of each kind the page holds. The recording keeps the rest. */
export const TOP = 100;

/** What the Tests view holds. */
export interface TestsData {
  readonly slowestFiles: readonly { readonly file: string; readonly duration: number }[];
  readonly slowestCases: readonly { readonly file: string; readonly name: string; readonly duration: number; readonly limit?: number }[];
  readonly retried: readonly RetriedCase[];
  /** Every case the recording holds an attempt trail for that ended differently. */
  readonly differing: number;
  /** Why a half is empty, in words: a record that holds nothing there says so rather than reading as none. */
  readonly notes: readonly string[];
}

/** What the Timeline view holds: the files that carry a start, the slowest of them, on the runner's clock. */
export interface TimelineData {
  readonly files: readonly TracedFile[];
  /** Files the recording holds that carry no start, which the axis cannot place. */
  readonly unplaced: number;
  readonly note?: string;
}

/** The recording a page was cut from. */
export interface ViewData {
  readonly suite?: string;
  readonly commit?: string;
  readonly recording?: string;
  readonly tests: TestsData;
  readonly timeline: TimelineData;
}

/** The slowest `TOP` files with a start, ordered by start so the page reads left to right. */
function placed(trace: Extract<RecordedTrace, { files: unknown }>): TimelineData {
  const starts = trace.files.filter((file) => file.start !== undefined && file.cost !== undefined);
  const kept = [...starts].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || (a.file < b.file ? -1 : 1)).slice(0, TOP);
  const files = kept.sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.file < b.file ? -1 : 1));
  const unplaced = trace.files.length - starts.length;
  return {
    files,
    unplaced,
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

function retriedOf(read: RecordedAttempts | undefined, notes: string[]): { readonly retried: readonly RetriedCase[]; readonly differing: number } {
  if (read === undefined) return { retried: [], differing: 0 };
  if ('unread' in read) {
    notes.push(`attempts: ${read.unread}`);
    return { retried: [], differing: 0 };
  }
  if ('unkept' in read) {
    notes.push('attempts: the recording kept none, so a retried case cannot be told from one that ran once');
    return { retried: [], differing: 0 };
  }
  return { retried: read.differed, differing: read.differing };
}

/** The suite asked for, or the first one that holds a recording. */
function pick<T extends { readonly suite?: string }>(rows: readonly T[], suite: string | undefined, readable: (row: T) => boolean): T | undefined {
  if (suite !== undefined) return rows.find((row) => row.suite === suite);
  return rows.find(readable) ?? rows[0];
}

/** The recording at `root` as the rows the page shows. */
export function viewData(root: string, suite?: string): ViewData {
  const notes: string[] = [];
  const timed = pick(recordedDurations(root, TOP), suite, (row) => !('unread' in row));
  const attempts = pick(recordedAttempts(root, TOP), suite, (row) => !('unread' in row));
  const traced = recordedTrace(root, suite ?? timed?.suite);
  const tests: TestsData = { ...durationsOf(timed, notes), ...retriedOf(attempts, notes), notes };
  const timeline: TimelineData = 'unread' in traced ? { files: [], unplaced: 0, note: traced.unread } : placed(traced);
  const commit = timed !== undefined && !('unread' in timed) ? timed.commit : undefined;
  return {
    ...(timed?.suite === undefined ? {} : { suite: timed.suite }),
    ...(commit === undefined ? {} : { commit }),
    ...(timed === undefined ? {} : { recording: timed.recording }),
    tests,
    timeline,
  };
}
