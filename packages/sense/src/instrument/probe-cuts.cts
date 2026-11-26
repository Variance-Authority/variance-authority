/**
 * Which test line first reached each region a case logged, and how long each
 * of a case's statements took.
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
 *
 * As a timed statement ends, the cut also reads what surrounded it: the
 * machine's load and free memory, the process's RSS, and the nodes it added to
 * the realm's page. Each is one draw of a random figure, read by no selection.
 */

import os = require('node:os');

/**
 * A bucket as the engine keeps it: its cuts, in an array every read replaces.
 * An alias, as the answer of `times` is spelled out: the engine hands these
 * out, and a declaration cannot name what an `export =` module keeps.
 */
type Cut = { cuts: number[] | null };

/**
 * The time a case's statements took so far, by line, the statement running
 * now, 0 between two, and whether an attempt of the case is running at all.
 */
interface Timer {
  readonly times: Map<number, number>;
  /** The machine as each line's last run ended. */
  readonly machine: Map<number, Machine>;
  /** The nodes each line's runs added to the page, summed; empty where the realm has no page. */
  readonly added: Map<number, number>;
  line: number;
  at: number;
  on: boolean;
}

/**
 * What surrounded a statement as it ended, each absent where the realm cannot
 * read it, spelled out again where `times` hands it out: the 1-minute load
 * average in hundredths, the process's RSS and the machine's free memory in
 * whole MiB, and the nodes it added to the page.
 */
interface Around {
  readonly load?: number;
  readonly rss?: number;
  readonly free?: number;
  readonly added?: number;
}

/** The figures of {@link Around} the machine answers, not the page. */
type Machine = Omit<Around, 'added'>;

const MIB = 1024 * 1024;

/**
 * How long a reading of the machine stands for the statements that end after
 * it, in milliseconds. Each reading is three system calls, about 1.2 µs, where
 * a cut is about 40 ns; none of its figures moves within a millisecond by more
 * than a draw does, and the load average moves every few seconds.
 */
const READING_MS = 1;

/** The part of a realm's DOM a node count reads. */
type Changes = readonly { readonly addedNodes: ArrayLike<unknown> }[];
type Realm = {
  readonly document?: object;
  readonly MutationObserver?: new (seen: (changes: Changes) => void) => {
    observe(target: object, options: object): void;
    takeRecords(): Changes;
  };
};

// TODO: a Playwright page lives outside the test's realm, and its cut
// (`documents.ts` in playwright-test) times no statement, so a page case
// records neither its statements' times nor the nodes each added (#1869).
/**
 * How many nodes the realm's page has had added, as a running count, each once
 * where it was inserted, as a story's page watch counts them; undefined where
 * the realm has no page. A node filled after it was attached counts its
 * children where they were inserted, so a read costs the changes since the
 * last one, never a walk of what they hold.
 */
function pageCount(realm: Realm | undefined): (() => number) | undefined {
  const { document, MutationObserver: Watch } = realm ?? {};
  if (document === undefined || typeof Watch !== 'function') return undefined;
  let added = 0;
  const count = (changes: Changes): void => {
    for (const change of changes) added += change.addedNodes.length;
  };
  const watch = new Watch(count);
  watch.observe(document, { childList: true, subtree: true });
  return () => {
    count(watch.takeRecords());
    return added;
  };
}

/** The machine's figures as a reading, each absent where this platform reports none. */
function machine(): Machine {
  const rss = typeof process === 'object' ? process.memoryUsage?.rss : undefined;
  return {
    // Windows reports a load average of 0 for ever, which is no reading.
    ...(os.platform() === 'win32' ? {} : { load: Math.round(os.loadavg()[0]! * 100) }),
    ...(typeof rss === 'function' ? { rss: Math.round(rss() / MIB) } : {}),
    free: Math.round(os.freemem() / MIB),
  };
}

/** @param realm Where the test runs, whose page the cuts count nodes on; none, or one without a page, counts none. */
function createCuts(realm?: object) {
  // The line each region was first reached under, by realm index, for the
  // last read that carried cuts.
  let lineAt = new Int32Array(0);
  // Read once, here, so the clock is the realm's own: a test that fakes its
  // timers replaces `performance.now` and `Date` after this took them.
  const clock = typeof performance === 'object' ? performance.now.bind(performance) : Date.now.bind(Date);
  // By bucket, not by its cuts: a read replaces the array, and the time stands.
  const timers = new WeakMap<Cut, Timer>();
  // Made at the first case, when a runner's environment has put its page in place.
  let page: (() => number) | undefined | null = null;
  // The machine as last read, and when.
  let reading: Machine = {};
  let readAt = -Infinity;
  // The page's count as the last statement to end took it: a node goes to the
  // statement that ends next, in whichever case, and to no other.
  let counted = 0;
  /**
   * Adds the time since the last cut to the statement that was running, with
   * what surrounded it as it ended, and starts `line` once that is read, so
   * the reading is charged to neither.
   */
  const lap = (timer: Timer, line: number): void => {
    const now = clock();
    let read = false;
    if (timer.line !== 0) {
      timer.times.set(timer.line, (timer.times.get(timer.line) ?? 0) + now - timer.at);
      if (now - readAt >= READING_MS) {
        reading = machine();
        readAt = now;
        read = true;
      }
      timer.machine.set(timer.line, reading);
    }
    if (page) {
      const added = page();
      if (timer.line !== 0) timer.added.set(timer.line, (timer.added.get(timer.line) ?? 0) + added - counted);
      counted = added;
      read = true;
    }
    timer.line = line;
    timer.at = read ? clock() : now;
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
      if (page === null) page = pageCount(realm as Realm | undefined);
      const timer = timers.get(bucket);
      if (timer === undefined) timers.set(bucket, { times: new Map(), machine: new Map(), added: new Map(), line: 0, at: 0, on: true });
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
     * Every statement timed since {@link time}, called as the case ends, which
     * closes its last statement: each line in the order the case first reached
     * it, a loop's runs summed, in whole microseconds on the real clock, beside
     * what surrounded it. No line is left out, however short. Undefined where
     * nothing was timed: absent, never zero.
     */
    times(bucket: Cut): ReadonlyArray<{
      readonly line: number; readonly time: number; readonly load?: number; readonly rss?: number; readonly free?: number; readonly added?: number;
    }> | undefined {
      const timer = timers.get(bucket);
      if (timer === undefined) return undefined;
      timers.delete(bucket);
      stop(timer);
      if (timer.times.size === 0) return undefined;
      return [...timer.times].map(([line, spent]) => {
        const added = timer.added.get(line);
        return { line, time: Math.round(spent * 1000), ...timer.machine.get(line), ...(added === undefined ? {} : { added }) };
      });
    },
  };
}

export = { createCuts };
