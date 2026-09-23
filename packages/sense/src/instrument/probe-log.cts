/**
 * What the emitted probe writes into: one flag per region, and a log of first
 * touches.
 *
 * Every collector this package ships — the Jest and Vitest ones, the page's,
 * a service's journeys — hands the probe the same object, and this is where it
 * comes from. The probe's side of the contract is in
 * [`index.ts`](index.ts); this file is the other side.
 *
 * ## Presence, logged once per segment
 *
 * Every reader of a recording asks two things of a region: was it entered, and
 * was it entered while a module was evaluating. Nobody reads how often. So a
 * region costs one byte of flags, and the first probe to find its bit clear sets
 * it and appends the region to a log. Every later probe of the region reads the
 * byte and returns. The log is the only thing a close has to read: a case that
 * entered two thousand regions of a realm that loaded two million is two
 * thousand entries, not two million counters.
 *
 * The byte holds two bits: 1 for *logged while nothing was evaluating*, 2 for
 * *logged while something was*. `passing` holds the bit that answers now, and
 * the probe tests the byte against it. A region entered at a module's top level
 * and again later is therefore logged once each way, and the evaluating depth
 * rising or falling clears nothing.
 *
 * A **segment** is the stretch over which the flags answer for one bucket. It
 * ends when the bucket changes: a case opening or settling, a journey's
 * continuation arriving. At the end, the flags logged inside it are cleared,
 * and nothing else is, because nothing else is set. So a switch costs what the
 * segment touched, and the flags are clear whenever a new bucket starts.
 *
 * ## One flag array, one bucket at a time
 *
 * Flags are per realm, logs are per bucket. That works because a flag only
 * ever means *logged in the current segment*, and the segment ends before any
 * other bucket writes. An async scope that interleaves two buckets — cases
 * under `continuations`, concurrent journeys — switches at every crossing
 * between them: the root's `s` is then a function that asks the scope which
 * bucket owns the crossing and switches when the answer moved, and the probe
 * reads a row of zeros in place of the flags so that every hit reaches it.
 * Every other collector leaves `s` null, and a switch happens only when the
 * collector calls `use`.
 *
 * A bucket switched through thousands of times re-logs what it touches after
 * each switch, so its log holds repeats. A log that has to grow is compacted
 * first when half of it would be repeats: each region kept once, where it was
 * first logged, with the evaluating bit of every entry for it. A byte per
 * region, zero between compactions, marks what has been kept, so a compaction
 * is two passes over the log and none over the rows. That bounds a long-lived
 * bucket — the ambient remainder, a flat file's, a page between drains — by the
 * regions it entered.
 *
 * ## What a close reads out
 *
 * Rows in the order the bucket first touched them, each row's ordinals
 * ascending and deduplicated, the evaluating bit an or over its entries. That
 * is the order and content `test-selection/journal-format.cts` encodes a map of
 * rows in, so it writes the frame straight from this view and the bytes are the
 * ones a map would give.
 *
 * A module whose text changed under a running realm — same id, another block
 * count — gets a new row, and the old row is dropped from every read: its
 * ordinals name regions the new text does not have.
 *
 * ## Written to be sent as text
 *
 * {@link createEngine} closes over everything it uses and names nothing from
 * this module, so its source is the page collector's too: `test-selection/probes.ts` sends
 * `createEngine.toString()` across the bundler. Node-only work — encoding
 * frames, keeping the file's union — lives with the callers in `test-selection/`.
 *
 * CommonJS for the reason `test-selection/journal-format.cts` is: Jest's setup file requires
 * it from inside the sandbox, from `node_modules`, untransformed.
 */

import type { ModuleId } from './index.js';

/** One caller's share of the log: a case, a journey, a file, a page between drains. */
interface Bucket {
  /** First touches: the region's index across the realm, or'd with the evaluating bit. */
  L: Int32Array<ArrayBuffer>;
  /** How many of {@link L} are written. */
  n: number;
  /** How many modules are evaluating inside this bucket. */
  d: number;
  /** How long the log was after its last compaction. */
  dense: number;
  /** The caller's name for it. */
  key: string;
  /** Whether the caller's scope is still running; the caller keeps it. */
  open: boolean;
  /** Whether it has been read out and dropped. */
  closed: boolean;
}

/**
 * The engine a realm's probes write into, with the buckets it logs for.
 *
 * @param scoped Whether the bucket follows an async scope. True makes every
 * probe call in and ask the resolver handed to `scope`, which is the price of
 * two scopes interleaving; false leaves the bucket to `use` alone.
 */
function createEngine(scoped: boolean) {
  const EVALUATING = -2147483648;
  const INDEX = 0x7fffffff;
  const NO_FLAGS = new Uint8Array(0);

  const rowIds: ModuleId[] = [];
  const rowCounts: number[] = [];
  const rowFlags: Uint8Array[] = [];
  const byId = new Map<ModuleId, number>();
  let rowBase = new Int32Array(256);
  let rowLive = new Uint8Array(256);
  let rowMark = new Int32Array(256);
  let rowStart = new Int32Array(256);
  let rowEnd = new Int32Array(256);
  let rowOf = new Int32Array(1 << 12);
  // Scratch for compaction, a byte per region, zero between compactions.
  let seen = new Uint8Array(1 << 12);
  let total = 0;

  const rows: number[] = [];
  let sorted = new Int32Array(1 << 12);
  let generation = 0;
  const spare: Int32Array<ArrayBuffer>[] = [];

  const ints = (from: Int32Array<ArrayBuffer>, length: number): Int32Array<ArrayBuffer> => {
    let size = Math.max(from.length, 1);
    while (size < length) size *= 2;
    if (size === from.length) return from;
    const grown = new Int32Array(size);
    grown.set(from);
    return grown;
  };
  const bytes = (from: Uint8Array<ArrayBuffer>, length: number): Uint8Array<ArrayBuffer> => {
    let size = from.length;
    while (size < length) size *= 2;
    if (size === from.length) return from;
    const grown = new Uint8Array(size);
    grown.set(from);
    return grown;
  };

  const open = (key: string): Bucket => ({
    L: spare.pop() ?? new Int32Array(1 << 12),
    n: 0,
    d: 0,
    dense: 0,
    key,
    open: true,
    closed: false,
  });

  // Where a probe writes when no caller's bucket is current: after a file's
  // last close, or between one scope settling and the next resolving. Nobody
  // reads it, which is what a crossing nothing is recording deserves.
  const idle = open('');
  let current = idle;
  let segmentAt = 0;
  let activation = 1;
  let resolveNow = (): Bucket => current;
  // Which flag bit answers now: 1 outside every evaluation, 2 inside one.
  const passing = new Uint8Array([1]);
  const registered: { f: Uint8Array; s: Uint8Array; b: number; p: Uint8Array } = {
    f: NO_FLAGS,
    s: NO_FLAGS,
    b: 0,
    p: passing,
  };
  // What the probe reads before it calls in. Where only `use` switches, that is
  // the flag itself, since every flag is clear after a switch. Where the scope
  // decides, a set flag may belong to the bucket the scope just left, so the
  // probe reads a row of zeros nobody writes and always calls in, where `s` is.
  const rowGates: Uint8Array[] = scoped ? [] : rowFlags;

  const sync = (): void => {
    const bucket = resolveNow();
    if (bucket !== current) use(bucket);
  };

  /** Clear what this segment logged, and start the next one. */
  const segment = (): void => {
    const log = root.L;
    const end = root.n;
    for (let at = segmentAt; at < end; at += 1) {
      const index = log[at]! & INDEX;
      const row = rowOf[index]!;
      rowFlags[row]![index - rowBase[row]!] = 0;
    }
    segmentAt = end;
  };

  const use = (bucket: Bucket): void => {
    if (bucket === current) return;
    segment();
    current.n = root.n;
    current = bucket;
    root.L = bucket.L;
    root.n = bucket.n;
    root.l = bucket.L.length;
    root.v = bucket.d > 0 ? EVALUATING : 0;
    passing[0] = bucket.d > 0 ? 2 : 1;
    segmentAt = bucket.n;
    activation += 1;
    root.a = activation;
  };

  /**
   * The log's rows in first-touch order, each row's ordinals shifted left one
   * with the evaluating bit below, ascending and deduplicated, in `sorted`
   * between `rowStart[row]` and `rowEnd[row]`.
   */
  const sort = (log: Int32Array<ArrayBuffer>, end: number): void => {
    generation += 1;
    rows.length = 0;
    for (let at = 0; at < end; at += 1) {
      const row = rowOf[log[at]! & INDEX]!;
      if (rowMark[row] !== generation) {
        rowMark[row] = generation;
        rowEnd[row] = 0;
        if (rowLive[row] === 1) rows.push(row);
      }
      rowEnd[row] = rowEnd[row]! + 1;
    }
    if (sorted.length < end) sorted = ints(sorted, end);
    let next = 0;
    for (const row of rows) {
      rowStart[row] = next;
      next += rowEnd[row]!;
      rowEnd[row] = rowStart[row]!;
    }
    for (let at = 0; at < end; at += 1) {
      const entry = log[at]!;
      const index = entry & INDEX;
      const row = rowOf[index]!;
      if (rowLive[row] === 1) {
        const into = rowEnd[row]!;
        sorted[into] = ((index - rowBase[row]!) << 1) | (entry >>> 31);
        rowEnd[row] = into + 1;
      }
    }
    for (const row of rows) {
      const from = rowStart[row]!;
      const to = rowEnd[row]!;
      // First touches arrive close to source order, which insertion sort takes
      // in one pass; a long row that was compacted and re-logged is two runs.
      if (to - from > 32) sorted.subarray(from, to).sort();
      else {
        for (let at = from + 1; at < to; at += 1) {
          const value = sorted[at]!;
          let into = at - 1;
          while (into >= from && sorted[into]! > value) {
            sorted[into + 1] = sorted[into]!;
            into -= 1;
          }
          sorted[into + 1] = value;
        }
      }
      let kept = from;
      for (let at = from; at < to; at += 1) {
        const value = sorted[at]!;
        if (kept > from && sorted[kept - 1]! >>> 1 === value >>> 1) sorted[kept - 1] = sorted[kept - 1]! | (value & 1);
        else sorted[kept++] = value;
      }
      rowEnd[row] = kept;
    }
  };

  /**
   * Write a bucket's log back without its repeats, each region where it was
   * first logged, with the evaluating bit of every entry for it. Two passes
   * over the log and none over the rows, so a log compacted while it grows
   * is not also sorted.
   */
  const compact = (bucket: Bucket): void => {
    const live = bucket === current;
    if (live) segment();
    const log = live ? root.L : bucket.L;
    const end = live ? root.n : bucket.n;
    for (let at = 0; at < end; at += 1) {
      const entry = log[at]!;
      const index = entry & INDEX;
      seen[index] = seen[index]! | (entry < 0 ? 3 : 1);
    }
    let written = 0;
    for (let at = 0; at < end; at += 1) {
      const index = log[at]! & INDEX;
      const mark = seen[index]!;
      if (mark === 0) continue;
      seen[index] = 0;
      if (rowLive[rowOf[index]!] === 1) log[written++] = mark === 3 ? index | EVALUATING : index;
    }
    bucket.n = written;
    bucket.dense = written;
    if (live) {
      root.n = written;
      segmentAt = written;
    }
  };

  /**
   * Sort a bucket's log into rows and, when the bucket goes on logging, write
   * it back in that order. A bucket being emptied skips the write.
   */
  const settle = (bucket: Bucket, keep: boolean): void => {
    const live = bucket === current;
    if (live) segment();
    const log = live ? root.L : bucket.L;
    sort(log, live ? root.n : bucket.n);
    if (!keep) return;
    let written = 0;
    for (const row of rows) {
      const base = rowBase[row]!;
      for (let at = rowStart[row]!; at < rowEnd[row]!; at += 1) {
        const value = sorted[at]!;
        log[written++] = (base + (value >>> 1)) | (value & 1 ? EVALUATING : 0);
      }
    }
    bucket.n = written;
    bucket.dense = written;
    if (live) {
      root.n = written;
      segmentAt = written;
    }
  };

  /** The probe's slow write: the log is full, or this is a re-activation's root. */
  const push = (entry: number): void => {
    let end = root.n;
    if (end >= root.l) {
      if (end >= current.dense * 2 + (1 << 12)) {
        compact(current);
        end = root.n;
      }
      if (end >= root.l) {
        const log = ints(root.L, end + 1);
        root.L = log;
        root.l = log.length;
        current.L = log;
      }
    }
    root.L[end] = entry;
    root.n = end + 1;
  };

  const register = (id: ModuleId, count: number): typeof registered => {
    let row = byId.get(id);
    if (row === undefined || rowCounts[row] !== count) {
      if (row !== undefined) rowLive[row] = 0;
      row = rowIds.length;
      if (total + count > INDEX) throw new Error('variance-authority: more regions than a log entry can address');
      byId.set(id, row);
      rowIds.push(id);
      rowCounts.push(count);
      rowFlags.push(new Uint8Array(count));
      if (scoped) rowGates.push(new Uint8Array(count));
      if (row >= rowBase.length) {
        rowBase = ints(rowBase, row + 1);
        rowMark = ints(rowMark, row + 1);
        rowStart = ints(rowStart, row + 1);
        rowEnd = ints(rowEnd, row + 1);
        rowLive = bytes(rowLive, row + 1);
      }
      rowBase[row] = total;
      rowLive[row] = 1;
      rowOf = ints(rowOf, total + count);
      seen = bytes(seen, total + count);
      rowOf.fill(row, total, total + count);
      total += count;
    }
    registered.f = rowGates[row]!;
    registered.s = rowFlags[row]!;
    registered.b = rowBase[row]!;
    return registered;
  };

  const raise = (): void => {
    if (scoped) sync();
    const bucket = current;
    bucket.d += 1;
    if (bucket.d === 1) {
      root.v = EVALUATING;
      passing[0] = 2;
    }
  };
  // Neither end of an evaluation ends a segment: `passing` moves to the other
  // flag bit, and a region's byte keeps one bit for each state.
  const lower = (): void => {
    if (scoped) sync();
    const bucket = current;
    const was = bucket.d;
    bucket.d = was > 1 ? was - 1 : 0;
    if (was === 1) {
      root.v = 0;
      passing[0] = 1;
    }
  };

  // The probe's side of this object, and nothing else: `a` the activation, a
  // number `use` moves on every switch; `s` the scope check, null unless the
  // bucket follows an async scope; `v` the evaluating bit; `n`/`l`/`L` the log;
  // `g` the slow write; `r` registration; `e`/`x` the evaluating depth. Built
  // with every field in place, so its shape never changes under the probes
  // that read it. `a` is a number and `s` a separate field, because an
  // accessor on `a` is not inlined and added about 6 ns to every scoped hit.
  const root = {
    a: activation,
    s: null as (() => void) | null,
    v: 0, n: 0, l: idle.L.length, L: idle.L, g: push, r: register, e: raise, x: lower,
  };

  const view = { rows, start: rowStart, end: rowEnd, sorted, ids: rowIds, counts: rowCounts };
  const read = (bucket: Bucket, keep = true) => {
    settle(bucket, keep);
    view.start = rowStart;
    view.end = rowEnd;
    view.sorted = sorted;
    return view;
  };

  /** Read a bucket out and empty it in place, leaving it current if it was. */
  const take = (bucket: Bucket) => {
    const out = read(bucket, false);
    bucket.n = 0;
    bucket.dense = 0;
    if (bucket === current) {
      root.n = 0;
      segmentAt = 0;
    }
    return out;
  };

  const api = {
    root,
    scoped,
    /** A new, empty bucket. */
    open,
    /** Make `bucket` the one the probes write into. */
    use,
    /** The scope's resolver, where the bucket follows an async scope. */
    scope(resolver: () => Bucket): void {
      resolveNow = resolver;
      // A closure over the resolver itself, so a probe's call reaches the
      // scope in one step rather than through a variable that could change.
      root.s = (): void => {
        const bucket = resolver();
        if (bucket !== current) use(bucket);
      };
    },
    read,
    take,
    /** Read a bucket out for the last time. The view lasts until the next read. */
    close(bucket: Bucket) {
      if (bucket === current) use(idle);
      const out = take(bucket);
      bucket.closed = true;
      if (bucket.L.length <= 1 << 20 && spare.length < 8) spare.push(bucket.L);
      bucket.L = new Int32Array(0);
      return out;
    },
    /**
     * A read-out as rows of ordinals. `byRow` orders them by when the realm
     * first registered each module rather than by when this bucket first
     * touched it, so a page drained several times reports one order.
     */
    lists(out: typeof view, byRow: boolean): { id: ModuleId; hits: number[]; shared: number[] }[] {
      const order = byRow ? [...out.rows].sort((left, right) => left - right) : out.rows;
      return order.map((row) => {
        const hits: number[] = [];
        const shared: number[] = [];
        for (let at = out.start[row]!; at < out.end[row]!; at += 1) {
          const value = out.sorted[at]!;
          hits.push(value >>> 1);
          if (value & 1) shared.push(value >>> 1);
        }
        return { id: out.ids[row]!, hits, shared };
      });
    },
  };
  Object.defineProperty(root, Symbol.for('variance-authority.test-selection.engine'), { value: api });
  return api;
}

type Engine = ReturnType<typeof createEngine>;

/** Where a realm's root keeps the engine behind it, so a second collector can find it. */
const ENGINE = Symbol.for('variance-authority.test-selection.engine');

/** The engine behind a realm's root, when the root is one of these. */
function engineOf(root: unknown): Engine | undefined {
  if (typeof root !== 'object' || root === null) return undefined;
  return (root as { [ENGINE]?: Engine })[ENGINE];
}

export = { createEngine, engineOf, ENGINE };
