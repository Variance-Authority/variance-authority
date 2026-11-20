/**
 * `limit`, as every listing question reads it: how many rows to show, where
 * every row is still counted and the rest are said.
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
