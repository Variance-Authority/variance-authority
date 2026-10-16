import { rangeOf, validateOffsets, type OpenSegment } from '@variance-authority/core/segment';
import type { TypeCarry } from './cache.js';

/**
 * The carry columns of a source-index generation: per parse, every container
 * the file declares that carries the members of a type it writes — an
 * interface it extends, an alias it intersects, a class it implements, the
 * props a component takes.
 *
 * One offset list, because the module reader records the list only when it is
 * not empty, so the empty range and the absent field are the same fact.
 */

/** Validate and open the columns. The reader answers one parse row as the field to spread into it. */
export function openCarries(
  opened: OpenSegment,
  text: (value: number) => string,
  parseCount: number,
): (row: number) => { readonly carries?: readonly TypeCarry[] } {
  const reject = (): never => { throw opened.reject(); };
  const offsets = opened.u32('parses.carries');
  const on = opened.u32('carries.on');
  const of = opened.u32('carries.of');
  validateOffsets(offsets, on.length, parseCount, reject);
  if (of.length !== on.length) reject();

  return (row) => {
    const carries = rangeOf(offsets, row, reject).map((at): TypeCarry => ({ on: text(on[at]!), of: text(of[at]!) }));
    return carries.length === 0 ? {} : { carries };
  };
}
