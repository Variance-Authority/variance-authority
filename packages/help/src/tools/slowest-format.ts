/**
 * The `docs_slowest_tests` answer as text. Per suite it reads as a story: which
 * record this is, whose and how old, then the cases closest to their limit,
 * the slowest files, and the slowest cases, each under a first line that names
 * the scope it applied. Asked for cases over a time, the question is about
 * cases, so the files stand aside.
 *
 * A case closest to its limit is stated as its run and its limit, never as a
 * breach: the run spans hooks and attempts, the limit one attempt, so a passing
 * case can read above it.
 *
 * A scope that matched nothing says which half matched nothing, and a `to`
 * path the record holds no row for is named as unrecorded: a table with no
 * rows would read as *no test is slow here*, which is a claim nobody measured.
 */

// compass: variance-authority.report.agent-surface

import type {
  DurationScope,
  RecordedCaseDurations,
  RecordedDurations,
  RecordOrigin,
  ScopeCounts,
  TimedTestCase,
} from '@variance-authority/sense';
import { ago } from '../ago.js';

/** A duration as a reader compares them: milliseconds under a second, seconds to a tenth above. */
export function spent(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

/** How much of a commit's name an answer prints: enough to find it, short enough to read. */
const COMMIT_WIDTH = 12;

const WHOSE: Readonly<Record<RecordOrigin, string>> = {
  own: "this checkout's record",
  mainline: 'the fetched mainline record',
  primary: "the primary checkout's record",
};

/** The time asked for as it was asked: tenths would move a threshold such as 4.96 s. */
function asked(over: number): string {
  return over % 100 === 0 ? spent(over) : `${over} ms`;
}

/** The answer, from what each suite's recording said, read at `now`; `over` is the time asked for, in milliseconds. */
export function formatSlowest(
  suites: readonly RecordedDurations[],
  scope: DurationScope = {},
  over?: number,
  now: number = Date.now(),
): string {
  const lines: string[] = [];
  const where = placeOf(scope);
  const atLeast = over === undefined ? '' : `, at least ${asked(over)}`;
  for (const suite of suites) {
    const of = suite.suite === undefined ? '' : `, suite ${suite.suite}`;
    if (lines.length > 0) lines.push('');
    const told = [
      recordLine(suite, now),
      closestSection(suite.cases, `Closest to their limit${of}${where}${atLeast}`),
      over === undefined ? section(suite, `Slowest recorded test files${of}${where}`, 'file', scope, (row) => row.file) : [],
      section(suite.cases, `Slowest recorded test cases${of}${where}${atLeast}`, 'case', scope, (row) =>
        `${row.file}  ${'name' in row ? row.name : ''}`, over),
    ];
    lines.push(...told.filter((part) => part.length > 0).flatMap((part, at) => (at === 0 ? part : ['', ...part])));
  }
  return lines.join('\n');
}

/** Which record this suite's answer read: whose run, at which commit, how old. An unread one says why where it is listed. */
function recordLine(suite: RecordedDurations, now: number): string[] {
  if ('unread' in suite) return [];
  const named = suite.suite === undefined ? 'Read' : `Suite ${suite.suite} read`;
  return [`${named} ${WHOSE[suite.origin]}${takenAt(suite, now)}, ${suite.recording}.`];
}

function takenAt({ commit, committed }: { readonly commit?: string; readonly committed?: string }, now: number): string {
  if (commit === undefined) return ', which names no commit';
  const short = commit.slice(0, COMMIT_WIDTH);
  return committed === undefined
    ? ` at ${short}, a commit this checkout does not hold, so its age is unknown`
    : ` at ${short}, committed ${ago(committed, now)}`;
}

/** The cases that ran the largest share of their limit, each as its run and its limit. */
function closestSection(cases: RecordedCaseDurations, named: string): string[] {
  if ('unread' in cases || cases.timed === 0) return [];
  if (cases.limited === 0) return [`${named}: none of the ${cases.timed} timed case(s) has a recorded limit, so they are listed by time alone.`];
  const pair = ({ duration, limit }: TimedTestCase): string => {
    const [run, held] = [spent(duration), spent(limit!)];
    // Tenths would read 4,960 ms of 5,000 as the whole limit spent.
    return run === held && duration !== limit ? `${duration} ms of ${limit} ms` : `${run} of ${held}`;
  };
  const wide = Math.max(...cases.closest.map((row) => pair(row).length));
  const unlimited = cases.timed - cases.limited;
  return [
    `${named}, each as run and limit:`,
    ...cases.closest.map((row) => `  ${pair(row).padStart(wide)}  ${row.file}  ${row.name}`),
    `${cases.closest.length} of ${cases.limited} limited case(s) shown` +
      `${unlimited === 0 ? '.' : `; ${unlimited} timed case(s) have no recorded limit.`}`,
  ];
}

/** The scope as the first line says it: `, under a, that entered b`. */
function placeOf(scope: DurationScope): string {
  const from = scope.from === undefined ? '' : `, under ${scope.from.join(' or ')}`;
  const to = scope.to === undefined ? '' : `, that entered ${scope.to.join(' or ')}`;
  return `${from}${to}`;
}

type Read = RecordedDurations | RecordedCaseDurations;
type Row = { readonly file: string; readonly duration: number; readonly name?: string };

function section(
  read: Read,
  named: string,
  noun: 'file' | 'case',
  scope: DurationScope,
  label: (row: Row) => string,
  over?: number,
): string[] {
  if ('unread' in read) return [`${named}: none read from ${read.recording}, ${read.unread}.`];
  const unrecorded = unrecordedLine(read.scope, read.recording);
  const faster = 'faster' in read ? read.faster : 0;
  const total = read.timed + read.untimed + faster;
  if (total === 0 && scope.from === undefined && scope.to === undefined) {
    return [`${named}: ${read.recording} holds no ${noun}.`];
  }
  if (total === 0) {
    // When no `to` path has a row, the first line already says so.
    const silent = scope.to !== undefined && read.scope.unrecorded.length === scope.to.length;
    return [`${named}: ${emptyScope(read.scope, noun, scope, read.recording)}`, ...(silent ? [] : unrecorded)];
  }
  if (read.timed === 0 && faster > 0) {
    return [
      `${named}: none of the ${faster} timed ${noun}(s) ran at least ${asked(over!)}` +
        `${read.untimed === 0 ? '.' : `; ${read.untimed} recorded ${noun}(s) have no duration.`}`,
      ...unrecorded,
    ];
  }
  if (read.timed === 0) {
    return [
      `${named}: none of the ${total} ${noun}(s) in ${read.recording} has a recorded duration. ` +
        'The next recorded run stores what its runner reports.',
      ...unrecorded,
    ];
  }
  const rows: readonly Row[] = read.slowest;
  const wide = Math.max(...rows.map((row) => spent(row.duration).length));
  return [
    `${named}, as their runner timed them:`,
    ...rows.map((row) => `  ${spent(row.duration).padStart(wide)}  ${label(row)}`),
    `${rows.length} of ${read.timed} timed ${noun}(s) shown` +
      `${faster === 0 ? '' : `; ${faster} ran faster`}` +
      `${read.untimed === 0 ? '.' : `; ${read.untimed} recorded ${noun}(s) have no duration.`}`,
    ...unrecorded,
  ];
}

/** Which half of the scope matched nothing, since an empty table would say no half did. */
function emptyScope(counts: ScopeCounts, noun: string, scope: DurationScope, recording: string): string {
  const from = scope.from?.join(' or ');
  const to = scope.to?.join(' or ');
  if (to !== undefined && counts.unrecorded.length === scope.to!.length) {
    return `${recording} holds no row at ${to}, so it cannot say which ${noun}s entered it.`;
  }
  if (from !== undefined && counts.declared === 0) return `no recorded ${noun} in ${recording} is declared under ${from}.`;
  if (to !== undefined && counts.entered === 0) return `no recorded ${noun} in ${recording} entered ${to}.`;
  return `no recorded ${noun} under ${from} entered ${to}, in ${recording}.`;
}

function unrecordedLine(counts: ScopeCounts, recording: string): string[] {
  if (counts.unrecorded.length === 0) return [];
  const paths = counts.unrecorded.map((path) => `\`${path}\``).join(', ');
  return [
    `Unrecorded: ${paths} ${counts.unrecorded.length === 1 ? 'has' : 'have'} no row in ${recording}, ` +
      'which says nothing about whether a test enters it.',
  ];
}
