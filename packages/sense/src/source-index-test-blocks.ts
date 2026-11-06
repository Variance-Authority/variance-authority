// compass: variance-authority.reach.source-index

import { rangeOf, sameLength, validateOffsets, type OpenSegment } from '@variance-authority/core/segment';
import type { TestBlock } from './cache.js';
import { spanAt } from './source-index-harvest.js';

/**
 * The test-block columns of a source-index generation: per parse, every titled
 * `describe`, `it` or `test` call. Apart from `symbols`, so a reader of a
 * file's top level never meets one.
 *
 * One offset list, because the module reader records the list only when it is
 * not empty, so the empty range and the absent field are the same fact.
 */

/** Validate and open the columns. The reader answers one parse row as the field to spread into it. */
export function openTestBlocks(
  opened: OpenSegment,
  text: (value: number) => string,
  parseCount: number,
): (row: number) => { readonly testBlocks?: readonly TestBlock[] } {
  const reject = (): never => { throw opened.reject(); };
  const offsets = opened.u32('parses.test-blocks');
  const title = opened.u32('test-blocks.title');
  const line = opened.u32('test-blocks.line');
  const docStart = opened.u32('test-blocks.doc-start');
  const docEnd = opened.u32('test-blocks.doc-end');
  validateOffsets(offsets, title.length, parseCount, reject);
  sameLength(title.length, [line, docStart, docEnd], reject);

  return (row) => {
    const testBlocks = rangeOf(offsets, row, reject).map((at): TestBlock => {
      const doc = spanAt(docStart, docEnd, at, reject);
      return {
        title: text(title[at]!),
        line: line[at]!,
        ...(doc === undefined ? {} : { doc }),
      };
    });
    return testBlocks.length === 0 ? {} : { testBlocks };
  };
}
