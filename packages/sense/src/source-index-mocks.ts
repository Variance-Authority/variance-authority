import { rangeOf, validateOffsets, type OpenSegment } from '@variance-authority/core/segment';
import type { ImportDiff } from './taint/index.js';

/**
 * The mock columns of a source-index generation: per parse, the specifiers the
 * file mocks and the ones it loads for real ([`taint/mocks.ts`](./taint/mocks.ts)).
 *
 * Two offset lists and nothing else, because a parse with neither side is a
 * parse whose `mocks` is absent: the module reader records a diff only when the
 * file wrote one, so the empty range and the absent field are the same fact.
 */

/** Validate and open the mock columns; the reader answers one parse row. */
export function openMocks(
  opened: OpenSegment,
  text: (value: number) => string,
  parseCount: number,
): (row: number) => ImportDiff | undefined {
  const reject = (): never => { throw opened.reject(); };
  const parseMinus = opened.u32('parses.mocks-minus');
  const parsePlus = opened.u32('parses.mocks-plus');
  const minusValue = opened.u32('mocks.minus');
  const plusValue = opened.u32('mocks.plus');
  validateOffsets(parseMinus, minusValue.length, parseCount, reject);
  validateOffsets(parsePlus, plusValue.length, parseCount, reject);

  return (row) => {
    const minus = rangeOf(parseMinus, row, reject).map((at) => text(minusValue[at]!));
    const plus = rangeOf(parsePlus, row, reject).map((at) => text(plusValue[at]!));
    if (minus.length === 0 && plus.length === 0) return undefined;
    return { ...(minus.length === 0 ? {} : { minus }), ...(plus.length === 0 ? {} : { plus }) };
  };
}
