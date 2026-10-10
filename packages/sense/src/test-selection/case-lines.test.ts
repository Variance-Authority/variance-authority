import { describe, expect, it } from 'vitest';
import { CaseLinesBuilder, decodeCaseLines, encodeCaseLines, lineAt, linesColumn, linesOf, lineValue } from './case-lines.js';

/** A test's lines built from `(module, block, line, ambient)` crossings in module and block order. */
function built(crossings: readonly (readonly [number, number, number, boolean])[], fallback?: number) {
  const builder = new CaseLinesBuilder();
  for (const [module, block, line, ambient] of crossings) builder.add(module, block, lineValue(line, ambient));
  return builder.finish(fallback);
}

describe('a case carries the test line that first reached each region', () => {
  it('reads back the line and the bucket of every region the case crossed', () => {
    const crossings = [
      [0, 0, 4, true], [0, 1, 4, true], [0, 3, 9, false],
      [2, 0, 4, true], [2, 5, 11, false], [2, 6, 11, false], [2, 7, 4, true],
      [5, 2, 0, true],
    ] as const;
    const lines = decodeCaseLines(encodeCaseLines(built(crossings)))!;
    for (const [module, block, line, ambient] of crossings) {
      expect(lineAt(lines, module, block), `${module}:${block}`).toEqual({ line, ambient });
    }
  });

  it('stores a module whose regions all share the most common line as nothing but that line', () => {
    const one = built([[0, 0, 4, true], [1, 0, 4, true], [1, 1, 4, true], [2, 3, 9, false]]);
    const many = built([
      [0, 0, 4, true], [1, 0, 4, true], [1, 1, 4, true], [2, 3, 9, false],
      ...Array.from({ length: 40 }, (_, module) => [module + 3, 0, 4, true] as const),
    ]);
    expect(one.segments.size).toBe(1);
    expect(many.segments.size).toBe(1);
    expect(encodeCaseLines(many).length).toBe(encodeCaseLines(one).length);
  });

  it('tells a case that crossed nothing from one whose lines were not recorded', () => {
    const nothing = encodeCaseLines(new CaseLinesBuilder().finish());
    expect(nothing.length).toBeGreaterThan(0);
    expect(decodeCaseLines(nothing)).toEqual({ table: [], fallback: undefined, segments: new Map() });
    expect(decodeCaseLines(new Uint8Array(0))).toBeUndefined();
  });

  it('keeps a fallback it is handed, for modules carried without a segment', () => {
    const lines = built([[3, 0, 9, false]], lineValue(4, true));
    const read = decodeCaseLines(encodeCaseLines(lines))!;
    expect(lineAt(read, 7, 12)).toEqual({ line: 4, ambient: true });
    expect(lineAt(read, 3, 0)).toEqual({ line: 9, ambient: false });
  });

  it('refuses bytes that end inside a test', () => {
    const bytes = encodeCaseLines(built([[0, 0, 4, true], [1, 2, 9, false]]));
    expect(() => decodeCaseLines(bytes.subarray(0, bytes.length - 1))).toThrow('not a variance-authority execution index');
  });

  it('writes no column when no case recorded lines, and reads each case off the one it writes', () => {
    expect(linesColumn([undefined, undefined])).toEqual({});
    const written = [built([[0, 1, 3, false]]), undefined, built([])];
    const column = linesColumn(written);
    const blob = column['lines.blob']!.plain;
    const offsets = new Uint32Array(column['lines.off']!.plain.buffer.slice(
      column['lines.off']!.plain.byteOffset,
      column['lines.off']!.plain.byteOffset + column['lines.off']!.plain.byteLength,
    ));
    expect(linesOf({ blob, offsets }, 0)).toEqual(written[0]);
    expect(linesOf({ blob, offsets }, 1)).toBeUndefined();
    expect(linesOf({ blob, offsets }, 2)).toEqual(written[2]);
    expect(linesOf(undefined, 0)).toBeUndefined();
  });
});
