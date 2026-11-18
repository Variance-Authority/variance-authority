/**
 * `variance story --page <pattern>`: when something appeared on the page, or
 * went from it. A story writes each change to the page as one line, so this
 * searches them as `rg` would and places each match at its step, test line
 * and React commit, rather than printing a page of markup to read.
 */

import { pageChanges, type PageChange, type Route } from '@variance-authority/sense/story';

/** Rows `--page` prints at most; the rest are counted, so a pattern that matches a whole list is narrowed rather than read. */
export const PAGE_ROWS = 50;

/** The changes to the page `pattern` matches, as text under the story's header, or as the json object's `page`. */
export function pageText(route: Route, pattern: string): string[] {
  const { searched, found } = pageChanges(route, pattern);
  if (found.length === 0) {
    return [`  no node holding \`${pattern}\` was added, removed or changed: the story says ${changes(searched)} to the page`];
  }
  const shown = found.slice(0, PAGE_ROWS);
  const cells = shown.map((row) => [row.kind, row.step === undefined ? '' : `step ${row.step}`, lineOf(row), row.commit === undefined ? '' : `commit ${row.commit}`]);
  const widths = cells[0]!.map((_, column) => Math.max(...cells.map((cell) => cell[column]!.length)));
  const rows = shown.map((row, at) => `  ${[...cells[at]!.flatMap((cell, column) => (widths[column] === 0 ? [] : [cell.padEnd(widths[column]!)])), row.change].join('  ')}`);
  const rest = found.length - shown.length;
  return [
    `  ${found.length} of ${changes(searched)} to the page ${found.length === 1 ? 'holds' : 'hold'} \`${pattern}\`; open a step with --around <step>`,
    ...rows,
    ...(rest > 0 ? [`  and ${rest} more; narrow the pattern`] : []),
  ];
}

/** The changes `pattern` matches, for json: the first {@link PAGE_ROWS}, and how many more there are. */
export function pageJson(route: Route, pattern: string): unknown {
  const { searched, found } = pageChanges(route, pattern);
  const more = found.length - PAGE_ROWS;
  return { pattern, searched, found: found.slice(0, PAGE_ROWS), ...(more > 0 ? { more } : {}) };
}

function lineOf(row: PageChange): string {
  if (row.line === undefined) return '';
  return row.hook === true ? `hook line ${row.line}` : `line ${row.line}`;
}

function changes(count: number): string {
  return count === 1 ? '1 change' : `${count} changes`;
}
