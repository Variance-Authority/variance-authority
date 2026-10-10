import { vlq, vlqOf } from './map-segments.js';

/**
 * A wrapped transformer's map of a cut test file, moved back to the file the
 * project wrote.
 *
 * Jest hands the cut text to the project's transformer, so the map it returns
 * names columns of the cut text. Every column the cut moved is moved back by
 * the `[line, column, length]` shifts `cadence` returned, and a column inside
 * an inserted call names the place it was inserted at. Lines never move.
 */
export function behindCut<Given extends string | { readonly mappings: string }>(map: Given, shifts: readonly number[]): Given {
  if (typeof map !== 'string') return { ...(map as { readonly mappings: string }), mappings: shift(map.mappings, byLine(shifts)) } as Given;
  const parsed = JSON.parse(map) as { mappings?: unknown };
  if (typeof parsed.mappings !== 'string') return map;
  return JSON.stringify({ ...parsed, mappings: shift(parsed.mappings, byLine(shifts)) }) as Given;
}

// Split, so no tool reads this module's text as its own inline map.
const MARKER = ['//#', 'sourceMappingURL'].join(' ');
const INLINE = /\/\/[#@] sourceMappingURL=data:application\/json(?:;charset=[\w-]+)?;base64,([A-Za-z0-9+/=]+)(?=\s*$)/u;

/**
 * `code` with the map a wrapped transformer left inline moved back, for one
 * such as `@swc/jest` that returns no `map` and Jest reads from the comment.
 */
export function inlineBehindCut(code: string, shifts: readonly number[]): string {
  const found = INLINE.exec(code);
  if (found === null) return code;
  const map = behindCut(Buffer.from(found[1]!, 'base64').toString('utf8'), shifts);
  const comment = `${MARKER}=data:application/json;charset=utf-8;base64,${Buffer.from(map).toString('base64')}`;
  return code.slice(0, found.index) + comment + code.slice(found.index + found[0].length);
}

type Shifts = ReadonlyMap<number, readonly (readonly [column: number, length: number])[]>;

function byLine(shifts: readonly number[]): Shifts {
  const lines = new Map<number, (readonly [number, number])[]>();
  for (let at = 0; at + 2 < shifts.length; at += 3) {
    const line = shifts[at]!;
    const row = lines.get(line) ?? [];
    row.push([shifts[at + 1]!, shifts[at + 2]!]);
    lines.set(line, row);
  }
  return lines;
}

/** The column of the written file a cut text's column on `line` was at. */
function back(lines: Shifts, line: number, column: number): number {
  let inserted = 0;
  for (const [at, length] of lines.get(line) ?? []) {
    const start = at + inserted;
    if (column < start) break;
    if (column < start + length) return at;
    inserted += length;
  }
  return column - inserted;
}

/**
 * `mappings` with each original column moved back. A field is a delta from the
 * same field of the segment before it, so every original column is decoded
 * whole, moved, and written as a delta from the one moved before it.
 */
function shift(mappings: string, lines: Shifts): string {
  let out = '';
  let index = 0;
  let line = 0;
  let column = 0;
  let written = 0;
  while (index < mappings.length) {
    const character = mappings[index]!;
    if (character === ';' || character === ',') {
      out += character;
      index += 1;
      continue;
    }
    const fields: number[] = [];
    while (index < mappings.length && mappings[index] !== ',' && mappings[index] !== ';') {
      const field = vlq(mappings, index);
      fields.push(field.value);
      index = field.next;
    }
    if (fields.length >= 4) {
      line += fields[2]!;
      column += fields[3]!;
      const moved = back(lines, line, column);
      fields[3] = moved - written;
      written = moved;
    }
    out += fields.map(vlqOf).join('');
  }
  return out;
}
