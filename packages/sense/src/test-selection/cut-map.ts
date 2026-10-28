import { columnBehindCut } from '../instrument/cadence.js';
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
  if (typeof map !== 'string') return { ...(map as { readonly mappings: string }), mappings: shift(map.mappings, columnBehindCut(shifts)) } as Given;
  const parsed = JSON.parse(map) as { mappings?: unknown };
  if (typeof parsed.mappings !== 'string') return map;
  return JSON.stringify({ ...parsed, mappings: shift(parsed.mappings, columnBehindCut(shifts)) }) as Given;
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

/**
 * `code` without the map a transformer left inline, and that map's JSON;
 * nothing when it left none.
 */
export function inlineMap(code: string): { readonly code: string; readonly map: string } | undefined {
  const found = INLINE.exec(code);
  if (found === null) return undefined;
  return {
    code: code.slice(0, found.index) + code.slice(found.index + found[0].length),
    map: Buffer.from(found[1]!, 'base64').toString('utf8'),
  };
}

/**
 * A cut that Node evaluates as it stands, with no transform after it: the map
 * a loader before the cut left inline is moved back, and where none did, the
 * cut's own map goes inline, so a stack frame names the file's columns.
 */
export function evaluatedCut(cut: { readonly code: string; readonly map: object; readonly shifts: readonly number[] }): string {
  const moved = inlineBehindCut(cut.code, cut.shifts);
  if (moved !== cut.code) return moved;
  return `${cut.code}${MARKER}=data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(cut.map)).toString('base64')}\n`;
}

/**
 * `mappings` with each original column moved back. A field is a delta from the
 * same field of the segment before it, so every original column is decoded
 * whole, moved, and written as a delta from the one moved before it.
 */
function shift(mappings: string, back: (line: number, column: number) => number): string {
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
      const moved = back(line, column);
      fields[3] = moved - written;
      written = moved;
    }
    out += fields.map(vlqOf).join('');
  }
  return out;
}
