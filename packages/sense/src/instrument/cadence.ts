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
 * bodies, so the case's log says which test line first reached each region, or
 * `undefined` for a file that does not parse or holds no such body.
 *
 * Every line keeps its number and columns move, so the cut carries a map: a
 * runner writes an inline snapshot into the call a stack frame names, by line
 * and column. The cut is a no-op in a realm with no recording, so the text runs
 * as it was without one. The walk is the instrumenter crate's
 * [`cadence.rs`](../../native/instrument/src/cadence.rs), and the collector's
 * side is [`probe-cuts.cts`](probe-cuts.cts).
 *
 * `awaited` is for a runner whose collector is outside the test's realm, as a
 * Playwright page is: each statement of an async body awaits what
 * `__VA__.c(line, file, hook)` returns, so the collector can drain what the
 * statement before it reached first; `file` tells a body declared elsewhere
 * apart. A body not async is cut without. In every realm a hook's cut says it
 * is a hook's, `__VA__.c(line, file, true)`: a page runs hooks and tests in one
 * realm, so nothing else there tells them apart.
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
