/**
 * The `docs_slowest_tests` answer as text: per suite, the slowest files, then
 * the slowest cases, each under a first line that names the scope it applied.
 *
 * A scope that matched nothing says which half matched nothing, and a `to`
 * path the record holds no row for is named as unrecorded: a table with no
 * rows would read as *no test is slow here*, which is a claim nobody measured.
 */

// compass: variance-authority.report.agent-surface

import type { DurationScope, RecordedCaseDurations, RecordedDurations, ScopeCounts } from '@variance-authority/sense';

/** A duration as a reader compares them: milliseconds under a second, seconds to a tenth above. */
export function spent(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

/** The answer, from what each suite's recording said: its files, then its cases. */
export function formatSlowest(suites: readonly RecordedDurations[], scope: DurationScope = {}): string {
  const lines: string[] = [];
  const where = placeOf(scope);
  for (const suite of suites) {
    const of = suite.suite === undefined ? '' : `, suite ${suite.suite}`;
    if (lines.length > 0) lines.push('');
    lines.push(
      ...section(suite, `Slowest recorded test files${of}${where}`, 'file', scope, (row) => row.file),
      '',
      ...section(suite.cases, `Slowest recorded test cases${of}${where}`, 'case', scope, (row) =>
        `${row.file}  ${'name' in row ? row.name : ''}`),
    );
  }
  return lines.join('\n');
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
): string[] {
  if ('unread' in read) return [`${named}: none read from ${read.recording}, ${read.unread}. A recorded test run writes it.`];
  const unrecorded = unrecordedLine(read.scope, read.recording);
  const total = read.timed + read.untimed;
  if (total === 0 && scope.from === undefined && scope.to === undefined) {
    return [`${named}: ${read.recording} holds no ${noun}.`];
  }
  if (total === 0) {
    // When no `to` path has a row, the first line already says so.
    const silent = scope.to !== undefined && read.scope.unrecorded.length === scope.to.length;
    return [`${named}: ${emptyScope(read.scope, noun, scope, read.recording)}`, ...(silent ? [] : unrecorded)];
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
    `${named}, as their runner reported them, from ${read.recording}:`,
    ...rows.map((row) => `  ${spent(row.duration).padStart(wide)}  ${label(row)}`),
    `${rows.length} of ${read.timed} timed ${noun}(s) shown` +
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
