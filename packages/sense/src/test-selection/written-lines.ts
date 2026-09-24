/**
 * A region's lines as the columnar formats hold them.
 *
 * A column is a number per region, and a region a transform wrote without an
 * origin has no lines to put there (`WrittenLines`). Lines count from one, so
 * zero is no line of any file: it is what the column holds for the absent
 * pair, and it is read back as absence, never as a line. Both ends are written
 * and read together — a region has both lines or neither.
 */

import type { WrittenLines } from './index.js';

export const NO_LINE = 0;

/** The pair a column holds at one region, as the lines it stands for. */
export function writtenLines(startLine: number, endLine: number): WrittenLines {
  return startLine === NO_LINE ? {} : { startLine, endLine };
}

/** A region with a place: every reader that asks by line, or prints one, reads only these. */
export function isWritten<T extends WrittenLines>(
  block: T,
): block is T & { readonly startLine: number; readonly endLine: number } {
  return block.startLine !== undefined;
}
