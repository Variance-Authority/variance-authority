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
  lines.push(...dropped(sessions).map((line) => `  ${line}`));
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
    '| Session | Functions ran | Loaded, not run | Ran in another text |',
    '|---|--:|--:|--:|',
    ...sessionRows(sessions).slice(1).map((row) => `| ${row.join(' | ')} |`),
  ];
  const drops = dropped(sessions);
  if (drops.length > 0) lines.push('', ...drops.map((line) => `- ${line}`));
  if (untested > 0) {
    lines.push('', '| File | Function | Lines | Sessions |', '|---|---|--:|---|');
    for (const { file, functions: ran } of sessions.untested) {
      lines.push(...ran.map((each) => `| \`${file}\` | \`${each.name}\` | ${linesOf(each)} | ${each.sessions.join(', ')} |`));
    }
  }
  lines.push('', '</details>');
  return lines;
}

/** What the sessions ran that no function is named from, and why, one line each. */
function dropped(sessions: CoverageSessions): readonly string[] {
  const lines: string[] = [];
  for (const each of sessions.each) {
    if (each.skipped.length > 0) lines.push(`${each.name} skipped ${grouped(each.skipped.length)} script${each.skipped.length === 1 ? '' : 's'} it could not place: ${each.skipped.join(', ')}`);
    if (each.unplaced.length > 0) lines.push(`${each.name} mapped to ${sources(each.unplaced.length)} not on this machine: ${each.unplaced.join(', ')}`);
    if (each.stale.length > 0) lines.push(`${each.name} ran ${sources(each.stale.length)} edited since its build, whose text its map does not hold: ${each.stale.join(', ')}`);
    if (each.uncut.length > 0) lines.push(`${each.name} could not cut ${sources(each.uncut.length)}: ${each.uncut.join(', ')}`);
    if (each.gone.length > 0) lines.push(`${each.name} ran ${functions(each.gone.length)} the checkout no longer holds, removed or renamed since: ${each.gone.join(', ')}`);
    if (each.outside.length > 0) lines.push(`${each.name} ran ${sources(each.outside.length)} outside the checkout or in a dependency: ${each.outside.join(', ')}`);
  }
  if (sessions.uncut.length > 0) {
    lines.push(`${grouped(sessions.uncut.length)} file${sessions.uncut.length === 1 ? '' : 's'} a session ran could not be cut in the checkout's text: ${sessions.uncut.join(', ')}`);
  }
  if (sessions.uncounted > 0) lines.push(`${functions(sessions.uncounted)} ran that no case can be counted for: the record holds them in another text, or loaded their file unprobed`);
  return lines;
}

function sessionRows(sessions: CoverageSessions): (readonly string[])[] {
  return [
    ['', 'functions ran', 'loaded, not run', 'ran in another text'],
    ...sessions.names.map((name, at) => {
      const said = sessions.files.flatMap((file) => file.functions.map((each) => each.sessions[at]));
      const count = (verdict: string): string => grouped(said.filter((each) => each === verdict).length);
      return [name, count('ran'), count('unrun'), count('other text')];
    }),
  ];
}

function linesOf(each: UntestedFunction): string {
  if (each.startLine === undefined) return '';
  return each.endLine === each.startLine ? String(each.startLine) : `${each.startLine}–${each.endLine}`;
}

function sources(count: number): string {
  return `${grouped(count)} source${count === 1 ? '' : 's'}`;
}

function functions(count: number): string {
  return `${grouped(count)} function${count === 1 ? '' : 's'}`;
}
