import { rangeOf, validateOffsets, type OpenSegment } from '@variance-authority/core/segment';
import type { OwnUse } from './cache.js';

/**
 * The own-use columns of a source-index generation: per parse, every line that
 * uses a name the file declares at its top level, once per name and line.
 *
 * One offset list, because the readers record the list only when it is not
 * empty, so the empty range and the absent field are the same fact.
 */

/** Validate and open the columns. The reader answers one parse row as the field to spread into it. */
export function openOwnUses(
  opened: OpenSegment,
  text: (value: number) => string,
  parseCount: number,
): (row: number) => { readonly ownUses?: readonly OwnUse[] } {
  const reject = (): never => { throw opened.reject(); };
  const offsets = opened.u32('parses.own-uses');
  const name = opened.u32('own-uses.name');
  const line = opened.u32('own-uses.line');
  validateOffsets(offsets, name.length, parseCount, reject);
  if (line.length !== name.length) reject();

  return (row) => {
    const ownUses = rangeOf(offsets, row, reject).map((at): OwnUse => ({ name: text(name[at]!), line: line[at]! }));
    return ownUses.length === 0 ? {} : { ownUses };
  };
}
