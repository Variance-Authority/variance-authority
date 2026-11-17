// compass: variance-authority.reach.crossings
/**
 * `variance coverage --session`, in words: per session, how many functions it
 * ran, and then the functions some session ran that no recorded case entered,
 * file by file, with the sessions that ran each. The JSON holds every function
 * of every file a session loaded.
 */

import type { CoverageSessions, UntestedFunction } from './coverage-sessions.js';
import { grouped, table } from './coverage-summary.js';

export function sessionsLines(sessions: CoverageSessions | undefined): readonly string[] {
  if (sessions === undefined) return [];
  const lines = ['sessions', ...table(sessionRows(sessions).map(([name, ...rest]) => [`  ${name}`, ...rest]))];
  for (const each of sessions.each) {
    if (each.skipped.length > 0) lines.push(`  ${each.name} skipped ${grouped(each.skipped.length)} script${each.skipped.length === 1 ? '' : 's'} it could not place: ${each.skipped.join(', ')}`);
    if (each.unplaced.length > 0) lines.push(`  ${each.name} mapped to ${grouped(each.unplaced.length)} source${each.unplaced.length === 1 ? '' : 's'} not on this machine: ${each.unplaced.join(', ')}`);
  }
  if (sessions.uncounted > 0) lines.push(`  ${functions(sessions.uncounted)} ran in a text the record holds otherwise: no case can be counted for them`);
  const untested = sessions.untested.reduce((sum, file) => sum + file.functions.length, 0);
  lines.push(`ran by a session, by no recorded case — ${functions(untested)}`);
  for (const { file, functions: ran } of sessions.untested) {
    lines.push(file, ...table(ran.map((each) => [`  ${each.name}`, linesOf(each), each.sessions.join(', ')])));
  }
  return lines;
}

export function sessionsMarkdown(sessions: CoverageSessions | undefined): readonly string[] {
  if (sessions === undefined) return [];
  const untested = sessions.untested.reduce((sum, file) => sum + file.functions.length, 0);
  const lines = [
    '',
    `<details><summary>🧭 Ran by a session, by no recorded case: ${functions(untested)}</summary>`,
    '',
    '| Session | Functions ran | Loaded, not run |',
    '|---|--:|--:|',
    ...sessionRows(sessions).slice(1).map((row) => `| ${row.join(' | ')} |`),
  ];
  if (untested > 0) {
    lines.push('', '| File | Function | Lines | Sessions |', '|---|---|--:|---|');
    for (const { file, functions: ran } of sessions.untested) {
      lines.push(...ran.map((each) => `| \`${file}\` | \`${each.name}\` | ${linesOf(each)} | ${each.sessions.join(', ')} |`));
    }
  }
  lines.push('', '</details>');
  return lines;
}

function sessionRows(sessions: CoverageSessions): (readonly string[])[] {
  return [
    ['', 'functions ran', 'loaded, not run'],
    ...sessions.names.map((name, at) => {
      const said = sessions.files.flatMap((file) => file.functions.map((each) => each.sessions[at]));
      return [name, grouped(said.filter((each) => each === 'ran').length), grouped(said.filter((each) => each === 'unrun').length)];
    }),
  ];
}

function linesOf(each: UntestedFunction): string {
  if (each.startLine === undefined) return '';
  return each.endLine === each.startLine ? String(each.startLine) : `${each.startLine}–${each.endLine}`;
}

function functions(count: number): string {
  return `${grouped(count)} function${count === 1 ? '' : 's'}`;
}
