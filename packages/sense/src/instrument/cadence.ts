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
 */
export function cadence(source: string, file: string): CutTestFile | undefined {
  const cut = instrumenter().cadence(source, file);
  if (cut === null) return undefined;
  return {
    code: cut.code,
    map: { version: 3, sources: [file], names: [], mappings: cut.mappings },
    shifts: cut.shifts,
  };
}
