import { NONE, sameLength, type OpenSegment } from '@variance-authority/core/segment';
import type { SourceSize } from './cache.js';

/**
 * The size columns of a source-index generation: per parse, the module's bytes,
 * the lines holding code, and the regions the instrument would cut it into
 * (`native/src/source_size.rs`).
 *
 * One value per row in each, `NONE` where the reader did not measure: a parse
 * from a reader that measures nothing has no size, and a module that did not
 * parse has bytes and lines and no region count.
 */

/** Validate and open the size columns; the reader answers one parse row. */
export function openSize(opened: OpenSegment, parseCount: number): (row: number) => { readonly size?: SourceSize } {
  const reject = (): never => { throw opened.reject(); };
  const bytes = opened.u32('parses.bytes');
  const lines = opened.u32('parses.lines');
  const blocks = opened.u32('parses.blocks');
  sameLength(parseCount, [bytes, lines, blocks], reject);

  return (row) => {
    if (bytes[row] === NONE || lines[row] === NONE) return {};
    const regions = blocks[row]!;
    return { size: { bytes: bytes[row]!, lines: lines[row]!, ...(regions === NONE ? {} : { blocks: regions }) } };
  };
}
