import { instrumenter } from './spliced.js';

/** The source map a cut carries back to the text it was handed. */
export interface CutSourceMap {
  readonly version: 3;
  readonly sources: string[];
  readonly names: string[];
  readonly mappings: string;
}

/** A cut test file, and where the cut moved its columns. */
export interface CutTestFile {
  readonly code: string;
  readonly map: CutSourceMap;
  /**
   * What was inserted, as `[line, column, length]` triples: zero-based, the
   * column the handed text's, in UTF-16 code units, in order.
   */
  readonly shifts: readonly number[];
}

/**
 * A test file with `__vaC(line)` before each statement of its test and hook
 * bodies, a hook's marked, or `undefined` when it does not parse or holds none.
 * Lines keep their numbers; columns move, so the cut carries a map. The walk is
 * [`cadence.rs`](../../native/instrument/src/cadence.rs), the collector's side
 * [`probe-cuts.cts`](probe-cuts.cts).
 *
 * `awaited` is for a collector outside the test's realm, as a Playwright page
 * is: an async body's statement awaits `__VA__.c(line, file, hook)`, so what
 * the statement before reached drains first.
 */
export function cadence(source: string, file: string, options: { readonly awaited?: boolean } = {}): CutTestFile | undefined {
  const cut = instrumenter().cadence(source, file, options.awaited === true);
  if (cut === null) return undefined;
  return {
    code: cut.code,
    map: { version: 3, sources: [file], names: [], mappings: cut.mappings },
    shifts: cut.shifts,
  };
}

/**
 * The column of the written file that a cut text's column was at, by zero-based
 * line, from the `[line, column, length]` shifts {@link cadence} returned. A
 * column inside an inserted call names the place it was inserted at; lines
 * never move.
 */
export function columnBehindCut(shifts: readonly number[]): (line: number, column: number) => number {
  const lines = new Map<number, (readonly [column: number, length: number])[]>();
  for (let at = 0; at + 2 < shifts.length; at += 3) {
    const line = shifts[at]!;
    const row = lines.get(line) ?? [];
    row.push([shifts[at + 1]!, shifts[at + 2]!]);
    lines.set(line, row);
  }
  return (line, column) => {
    let inserted = 0;
    for (const [at, length] of lines.get(line) ?? []) {
      const start = at + inserted;
      if (column < start) break;
      if (column < start + length) return at;
      inserted += length;
    }
    return column - inserted;
  };
}
