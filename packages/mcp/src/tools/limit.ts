/**
 * `limit`, as every listing question reads it: how many rows to show, where
 * every row is still counted and the rest are said. A question that answers
 * one ordered list also reads `offset`, the rows to skip, and names the offset
 * of its next page, so a reader past the first page asks for that page rather
 * than for every row.
 */

// compass: variance-authority.report.agent-surface

import type { Spelling } from './spelling.js';

/**
 * The `limit` said in `input`, from the wire as a number or from the shell as
 * its digits, or `shown` when none is said. Anything but a whole number of at
 * least one is refused, never read as the default, and the refusal names
 * `limit` as the surface asked takes it.
 */
export function limitOf(input: Readonly<Record<string, unknown>>, shown: number, spell: Spelling): number {
  const said = input['limit'];
  if (said === undefined) return shown;
  const limit = typeof said === 'string' && said.trim() !== '' ? Number(said) : said;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`\`${spell.input('limit')}\` takes a whole number of rows, at least 1; it was given \`${String(said)}\`.`);
  }
  return limit;
}

/** What a listing's rows are called, for one row and for more. */
export interface Rows {
  readonly one: string;
  readonly many: string;
}

/**
 * What a listing says of the rows it left out, naming `limit` as the surface
 * asked takes it: `limit` on the wire, `--limit` from a shell. `rows` names
 * them, where one answer holds more than one list.
 */
export function notShown(rest: number, spell: Spelling, rows?: Rows): string {
  const noun = rows === undefined ? '' : `${rest === 1 ? rows.one : rows.many} `;
  return `${rest} more ${noun}not shown; a higher \`${spell.input('limit')}\` shows them.`;
}

/** The line counting the `count` rows past the first `limit`; none when there are no more. */
export function notShownPast(count: number, limit: number, spell: Spelling, rows?: Rows): readonly string[] {
  return count > limit ? [notShown(count - limit, spell, rows)] : [];
}

/** One page of an ordered list: `limit` rows after the first `offset`. */
export interface Page {
  readonly offset: number;
  readonly limit: number;
}

/**
 * The page said in `input`: `limit` as `limitOf` reads it, and `offset`, 0
 * when none is said. An offset that is not a whole number of at least 0 is
 * refused, naming `offset` as the surface asked takes it.
 */
export function pageOf(input: Readonly<Record<string, unknown>>, shown: number, spell: Spelling): Page {
  const said = input['offset'];
  const offset = said === undefined ? 0 : typeof said === 'string' && said.trim() !== '' ? Number(said) : said;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new Error(`\`${spell.input('offset')}\` takes a whole number of rows to skip, 0 or more; it was given \`${String(said)}\`.`);
  }
  return { offset, limit: limitOf(input, shown, spell) };
}

/** The rows of `page`, in the list's order. */
export function paged<Row>(rows: readonly Row[], page: Page): readonly Row[] {
  return rows.slice(page.offset, page.offset + page.limit);
}

/**
 * What a page says above its rows when it does not start at the first: which
 * of the `total` rows it shows, or that `offset` is past the last of them.
 */
export function pageAt(page: Page, total: number, spell: Spelling): readonly string[] {
  if (page.offset === 0) return [];
  if (page.offset >= total) return [`\`${spell.input('offset')}\` ${page.offset} is past the last of ${total} rows.`];
  return [`Rows ${page.offset + 1}–${Math.min(total, page.offset + page.limit)} of ${total}.`];
}

/**
 * What a page says below its rows when rows remain after it: how many, and
 * the `offset` that shows the next page, as the surface asked takes it. A
 * caller that can spell the whole question it was asked passes `question`,
 * which writes that question at a given offset, already in backticks: the
 * reader then copies the next page rather than editing a flag into the last.
 */
export function nextPage(page: Page, total: number, spell: Spelling, question?: (offset: number) => string): readonly string[] {
  const next = page.offset + page.limit;
  if (next >= total) return [];
  const rest = total - next;
  const shown = Math.min(rest, page.limit);
  return [question === undefined
    ? `${rest} more not shown; \`${spell.input('offset')}\` ${next} shows the next ${shown}.`
    : `${rest} more not shown; the next ${shown}: ${question(next)}.`];
}
