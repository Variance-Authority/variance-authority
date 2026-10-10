import { instrumenter } from './spliced.js';

/**
 * A test file with `__vaC(line)` before each statement of its test and hook
 * bodies, so the case's log says which test line first reached each region, or
 * `undefined` for a file that does not parse or holds no such body.
 *
 * Every line keeps its number; only columns move. The cut is a no-op in a
 * realm with no recording, so the text runs as it was without one. The walk is
 * the instrumenter crate's
 * [`cadence.rs`](../../native/instrument/src/cadence.rs), and the collector's
 * side is [`probe-cuts.cts`](probe-cuts.cts).
 */
export function cadence(source: string, file: string): string | undefined {
  return instrumenter().cadence(source, file) ?? undefined;
}
