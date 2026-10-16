import { rangeOf, validateOffsets, type OpenSegment } from '@variance-authority/core/segment';
import type { TypeCarry } from './cache.js';

/**
 * The carry columns of a source-index generation: per parse, every container
 * the file declares that carries the members of a type it writes — an
 * interface it extends, an alias it intersects, a class it implements, the
 * props a component takes.
 *
 * One offset list per list, because the module reader records each only when
 * it is not empty, so the empty range and the absent field are the same fact:
 * the parses, and each carry's kept and dropped keys.
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
  const onlyOffsets = opened.u32('carries.only');
  const only = opened.u32('carry-only.name');
  const exceptOffsets = opened.u32('carries.except');
  const except = opened.u32('carry-except.name');
  validateOffsets(offsets, on.length, parseCount, reject);
  validateOffsets(onlyOffsets, only.length, on.length, reject);
  validateOffsets(exceptOffsets, except.length, on.length, reject);
  if (of.length !== on.length) reject();
  const keys = (at: number, ends: Uint32Array, names: Uint32Array): string[] => rangeOf(ends, at, reject).map((key) => text(names[key]!));

  return (row) => {
    const carries = rangeOf(offsets, row, reject).map((at): TypeCarry => {
      const kept = keys(at, onlyOffsets, only);
      const dropped = keys(at, exceptOffsets, except);
      return {
        on: text(on[at]!),
        of: text(of[at]!),
        ...(kept.length === 0 ? {} : { only: kept }),
        ...(dropped.length === 0 ? {} : { except: dropped }),
      };
    });
    return carries.length === 0 ? {} : { carries };
  };
}
