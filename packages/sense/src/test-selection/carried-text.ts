/**
 * How far the text a map carries for a file is believed, where it is not the
 * file. A host can carry the text of a step that answered `map: null`, so a text
 * that differs says nothing about a region until the region's lines are compared.
 */

import { instrument, type InstrumentOptions } from '../instrument/index.js';

/**
 * Whether `carried`, the text a map carries for the file, if it carries one,
 * stands for the file: it is one of `texts`, the file as a step can be handed
 * it, or it is one of them on every line a region other than the module's sits
 * on. A map is trusted on its source's name only where it says nothing more.
 * A position on such a line keeps its line and its column, and a position on
 * any other names no region there, since a column past a line's end stays on
 * its line.
 */
export function carriesTheFile(
  carried: string | null | undefined,
  texts: readonly string[],
  file: string,
  mode: InstrumentOptions['mode'],
): boolean {
  if (typeof carried !== 'string' || texts.includes(carried)) return true;
  // A blanked text has the file's offsets. A file that cannot be cut has no region to compare.
  const cut = instrument(texts[0]!, file, file, mode === undefined ? {} : { mode });
  const regions = cut?.blocks.filter((block) => block.kind !== 'module') ?? [];
  return texts.some((text) => sameUnder(text, carried, regions));
}

/** Whether `carried` is `text`, line for line, at every line `regions`, offsets into `text`, touch. */
function sameUnder(text: string, carried: string, regions: readonly { readonly start: number; readonly end: number }[]): boolean {
  const written = carried.split('\n');
  let start = 0;
  for (const [index, line] of text.split('\n').entries()) {
    const end = start + line.length;
    if (line !== written[index] && regions.some((region) => region.start <= end && region.end >= start)) return false;
    start = end + 1;
  }
  return true;
}
