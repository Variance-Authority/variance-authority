/**
 * The segments of a source map's `mappings`, decoded into the fields a line
 * lookup needs. `sourceLines` in `source-lines.ts` is the only reader.
 */

export interface Segment {
  readonly column: number;
  readonly source: number;
  readonly line: number;
  /**
   * Opens its generated line with the origin the segment before it ended on:
   * the statement above continuing, not something written here.
   */
  readonly carried: boolean;
}

/** Segments per generated line, carrying only the fields a position needs. */
export function decode(mappings: string): readonly (readonly Segment[])[] {
  const lines: Segment[][] = [];
  let segments: Segment[] = [];
  let column = 0;
  let source = 0;
  let line = 0;
  let original = 0;
  let previous: { readonly source: number; readonly line: number; readonly original: number } | undefined;
  let index = 0;

  while (index < mappings.length) {
    const char = mappings[index];
    if (char === ';') {
      // Only the line just above can carry an origin onto the next one.
      if (segments.length === 0) previous = undefined;
      lines.push(segments);
      segments = [];
      column = 0;
      index += 1;
      continue;
    }
    if (char === ',') {
      index += 1;
      continue;
    }

    const first = vlq(mappings, index);
    column += first.value;
    index = first.next;
    if (boundary(mappings, index)) {
      // Unmapped code: what follows it carries nothing over.
      previous = undefined;
      continue;
    }

    const second = vlq(mappings, index);
    source += second.value;
    const third = vlq(mappings, second.next);
    line += third.value;
    // The original column. A diff's unit is the line, so it only tells a
    // carried origin from a new one on the same line.
    const fourth = vlq(mappings, third.next);
    original += fourth.value;
    index = fourth.next;
    if (!boundary(mappings, index)) index = vlq(mappings, index).next;

    const carried =
      segments.length === 0 &&
      previous !== undefined &&
      previous.source === source &&
      previous.line === line &&
      previous.original === original;
    previous = { source, line, original };
    segments.push({ column, source, line, carried });
  }

  lines.push(segments);
  return lines;
}

function boundary(mappings: string, index: number): boolean {
  return index >= mappings.length || mappings[index] === ',' || mappings[index] === ';';
}

const DIGITS = new Map<string, number>(
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map(
    (character, value) => [character, value],
  ),
);

/** One base64 VLQ field, and where the next one starts. */
function vlq(mappings: string, at: number): { readonly value: number; readonly next: number } {
  let result = 0;
  let shift = 0;
  let index = at;

  for (;;) {
    const digit = DIGITS.get(mappings[index] ?? '');
    if (digit === undefined) return { value: 0, next: index + 1 };
    index += 1;
    result += (digit & 31) << shift;
    if ((digit & 32) === 0) break;
    shift += 5;
  }

  const negative = (result & 1) === 1;
  return { value: negative ? -(result >>> 1) : result >>> 1, next: index };
}
