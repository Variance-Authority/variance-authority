/**
 * Which test line first reached each region a case logged, and which of a
 * case's statements took longest.
 *
 * A cut test file calls the root's `c(line)` before each statement of a test or
 * a hook (`native/instrument/src/cadence.rs`). The engine keeps each bucket's
 * cuts as pairs — the line, then the log's length when it was reached — and
 * hands them here: a cut that follows another with nothing logged between them
 * takes its place, so a loop costs what it reached, and a read charges each
 * region to the last cut before its first entry, 0 before any. Time is kept
 * apart from the pairs for that reason: a collapsed cut still took time.
 *
 * Only a test runner's collector cuts, so this file is not sent as text and
 * the engine's source does not grow by it. CommonJS as `probe-log.cts` is.
 */

/**
 * A bucket as the engine keeps it: its cuts, in an array every read replaces.
 * An alias, as the answer of `slowest` is spelled out: the engine hands these
 * out, and a declaration cannot name what an `export =` module keeps.
 */
type Cut = { cuts: number[] | null };

/**
 * The time a case's statements took so far, by line, the statement running
 * now, 0 between two, and whether an attempt of the case is running at all.
 */
interface Timer {
  readonly times: Map<number, number>;
  line: number;
  at: number;
  on: boolean;
}

function createCuts() {
  // The line each region was first reached under, by realm index, for the
  // last read that carried cuts.
  let lineAt = new Int32Array(0);
  // Read once, here, so the clock is the realm's own: a test that fakes its
  // timers replaces `performance.now` and `Date` after this took them.
  const clock = typeof performance === 'object' ? performance.now.bind(performance) : Date.now.bind(Date);
  // By bucket, not by its cuts: a read replaces the array, and the time stands.
  const timers = new WeakMap<Cut, Timer>();
  /** Adds the time since the last cut to the statement that was running, and starts `line`. */
  const lap = (timer: Timer, line: number): void => {
    const now = clock();
    if (timer.line !== 0) timer.times.set(timer.line, (timer.times.get(timer.line) ?? 0) + now - timer.at);
    timer.line = line;
    timer.at = now;
  };
  /** Closes the statement in flight, if one is: between two there is no clock to read. */
  const stop = (timer: Timer): void => {
    if (timer.on && timer.line !== 0) lap(timer, 0);
    timer.on = false;
  };
  return {
    /** A cut at `line` of the bucket whose log is `at` long. */
    cut(bucket: Cut, line: number, at: number): void {
      const timer = timers.get(bucket);
      if (timer?.on === true) lap(timer, line);
      const cuts = bucket.cuts!;
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
    /**
     * Starts timing the statements cut into `bucket`, as a case's body starts.
     * A retry of a case still open adds to the attempt before it. Cuts nobody
     * timed — a hook's, the file's own — cost no clock read.
     */
    time(bucket: Cut): void {
      if (bucket.cuts === null) return;
      const timer = timers.get(bucket);
      if (timer === undefined) timers.set(bucket, { times: new Map(), line: 0, at: 0, on: true });
      else { stop(timer); timer.on = true; }
    },
    /**
     * The attempt is over: the statement in flight ends here, and a body the
     * runner gave up on, cutting on past its attempt, adds nothing.
     */
    stop(bucket: Cut): void {
      const timer = timers.get(bucket);
      if (timer !== undefined) stop(timer);
    },
    /**
     * The statement that took longest since {@link time}, called as the case
     * ends, which closes its last statement. A statement in a loop is the sum
     * of its runs, and of two equal the first reached stands. Undefined where
     * nothing was timed or nothing took a whole millisecond: absent, never zero.
     * @returns The statement's line in the test file, and whole milliseconds.
     */
    slowest(bucket: Cut): { readonly line: number; readonly time: number } | undefined {
      const timer = timers.get(bucket);
      if (timer === undefined) return undefined;
      timers.delete(bucket);
      stop(timer);
      let line = 0;
      let most = 0;
      for (const [at, spent] of timer.times) {
        if (spent > most) [line, most] = [at, spent];
      }
      const time = Math.floor(most);
      return time < 1 ? undefined : { line, time };
    },
  };
}

export = { createCuts };
