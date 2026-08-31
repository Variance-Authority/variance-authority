/**
 * Where a block was written, as against where the bundler put it.
 *
 * Probes are spliced into whatever the bundler hands the plugin, and by then a
 * `.tsx` module has been through a JSX transform: blank lines dropped, elements
 * expanded over several lines each, a `keepNames` prologue on top. Sixty-one
 * lines of source arrive as a hundred and eighteen, and none of them are where
 * they started.
 *
 * The extents recorded beside each block have exactly one reader — a diff — and
 * a diff speaks in the coordinates of the file the author edited. Recorded from
 * the transformed text they are not approximately right, they are a different
 * number line, and the selector answers with whichever regions happen to sit at
 * those offsets after the transform. That failure is silent and it is not even
 * consistently wrong, which is the worst shape a wrong answer has.
 *
 * So the extents are translated back through the map the bundler already keeps.
 * Nothing here is a source map implementation: it decodes the one field that
 * carries positions and answers one question — *which line of the original was
 * this offset written on* — and every case it cannot answer falls back to the
 * generated line, which is the pre-existing behaviour rather than a guess.
 */

import { lineAt } from './instrumented-modules.js';

/** The two fields of a bundler's map this reads. */
export interface TransformSourceMap {
  readonly mappings: string;
  readonly sources: readonly (string | null)[];
}

/** An offset into the transformed text, answered as a line of the original. */
export type LineOf = (offset: number) => number;

interface Segment {
  readonly column: number;
  readonly source: number;
  readonly line: number;
}

/**
 * A lookup from transformed offsets to original lines.
 *
 * `file` narrows a map that names more than one source — a bundler that inlined
 * a helper alongside the module still reports one file's mappings among
 * another's, and a segment from the helper would place a block in a file the
 * diff will never name. When no source matches, every segment is accepted: a map
 * whose paths are written relative to a root this cannot see is still that
 * module's map, and the alternative is discarding it whole.
 */
export function sourceLines(
  code: string,
  map: TransformSourceMap | undefined,
  file: string,
): LineOf {
  const generated = (offset: number): number => lineAt(code, offset);
  if (map === undefined || map.mappings === '') return generated;

  const only = sourceIndex(map.sources, file);
  const lines = decode(map.mappings);
  const starts = lineStarts(code);

  return (offset) => {
    const line = generated(offset) - 1;
    const column = offset - (starts[line] ?? 0);
    const found = nearest(lines, line, column, only);
    return found === undefined ? line + 1 : found + 1;
  };
}

/**
 * The segment covering a position, or the last one before it.
 *
 * A transformed line with no segments of its own is code the bundler emitted
 * without an origin — a helper prologue, a hoisted import — and the honest
 * answer for it is the origin of the last thing that had one, walking back
 * rather than reporting the top of the file.
 */
function nearest(
  lines: readonly (readonly Segment[])[],
  line: number,
  column: number,
  only: number | undefined,
): number | undefined {
  for (let at = Math.min(line, lines.length - 1); at >= 0; at -= 1) {
    const segments = lines[at];
    if (segments === undefined) continue;
    let best: Segment | undefined;
    for (const segment of segments) {
      if (only !== undefined && segment.source !== only) continue;
      // Past the position on its own line. Earlier lines are read to their end,
      // because what is wanted there is the last origin before the position.
      if (at === line && segment.column > column) break;
      best = segment;
    }
    if (best !== undefined) return best.line;
  }
  return undefined;
}

function sourceIndex(sources: readonly (string | null)[], file: string): number | undefined {
  const found = sources.findIndex((source) => source !== null && names(file, source));
  return found === -1 ? undefined : found;
}

function names(file: string, source: string): boolean {
  const tail = source.replace(/^(?:\.\.?\/)+/, '');
  return file === source || file.endsWith(`/${tail}`);
}

function lineStarts(code: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

/** Segments per generated line, carrying only the fields a position needs. */
function decode(mappings: string): readonly (readonly Segment[])[] {
  const lines: Segment[][] = [];
  let segments: Segment[] = [];
  let column = 0;
  let source = 0;
  let line = 0;
  let index = 0;

  while (index < mappings.length) {
    const char = mappings[index];
    if (char === ';') {
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
    if (boundary(mappings, index)) continue;

    const second = vlq(mappings, index);
    source += second.value;
    const third = vlq(mappings, second.next);
    line += third.value;
    // The original column, decoded so the cursor lands on the next field and
    // discarded because a diff's unit is the line.
    index = vlq(mappings, third.next).next;
    if (!boundary(mappings, index)) index = vlq(mappings, index).next;

    segments.push({ column, source, line });
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
