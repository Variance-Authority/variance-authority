/**
 * Which test line first reached each region a case logged.
 *
 * A cut test file calls the root's `c(line)` before each statement of a test or
 * a hook (`native/instrument/src/cadence.rs`). The engine keeps each bucket's
 * cuts as pairs — the line, then the log's length when it was reached — and
 * hands them here: a cut that follows another with nothing logged between them
 * takes its place, so a loop costs what it reached, and a read charges each
 * region to the last cut before its first entry, 0 before any.
 *
 * Only a test runner's collector cuts. An engine built without this — a page's,
 * a service's — keeps no cuts and carries no lines, so this file is not sent
 * as text and the engine's source does not grow by it. CommonJS for the reason
 * `probe-log.cts` is.
 */

function createCuts() {
  // The line each region was first reached under, by realm index, for the
  // last read that carried cuts.
  let lineAt = new Int32Array(0);
  return {
    /** A cut at `line` with the log `at` long. */
    cut(cuts: number[], line: number, at: number): void {
      if (cuts.length > 0 && cuts[cuts.length - 1] === at) cuts[cuts.length - 2] = line;
      else cuts.push(line, at);
    },
    /** After a compaction moved them: cuts left at one position reached nothing between them, so the last stands. */
    merge(cuts: number[]): void {
      let kept = 0;
      for (let at = 0; at < cuts.length; at += 2) {
        if (kept > 0 && cuts[kept - 1] === cuts[at + 1]) kept -= 2;
        cuts[kept++] = cuts[at]!;
        cuts[kept++] = cuts[at + 1]!;
      }
      cuts.length = kept;
    },
    /**
     * Each region of the log by realm index, `log[at] & index`, at the line
     * that first reached it, or undefined where nothing was cut.
     */
    charge(log: Int32Array, end: number, cuts: number[], index: number, total: number): Int32Array | undefined {
      if (cuts.length === 0) return undefined;
      if (lineAt.length < total) lineAt = new Int32Array(Math.max(total, lineAt.length * 2));
      for (let at = 0; at < end; at += 1) lineAt[log[at]! & index] = -1;
      let line = 0;
      let cut = 0;
      for (let at = 0; at < end; at += 1) {
        for (; cut < cuts.length && cuts[cut + 1]! <= at; cut += 2) line = cuts[cut]!;
        const region = log[at]! & index;
        if (lineAt[region] === -1) lineAt[region] = line;
      }
      return lineAt;
    },
    /**
     * What a bucket read out and emptied starts over with: its last cut, so
     * work that outlives the case's last statement is charged to that statement
     * in the frame it is read out in. Null, a kept read's, starts with none.
     */
    after(cuts: number[] | null): number[] {
      return cuts === null || cuts.length === 0 ? [] : [cuts[cuts.length - 2]!, 0];
    },
  };
}

export = { createCuts };
