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

/**
 * What a listing says of the rows it left out, naming `limit` as the surface
 * asked takes it: `limit` on the wire, `--limit` from a shell.
 */
export function notShown(rest: number, spell: Spelling): string {
  return `${rest} more not shown; a higher \`${spell.input('limit')}\` shows them.`;
}
