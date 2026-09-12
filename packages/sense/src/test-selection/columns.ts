import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { fail } from './format-validation.js';

/**
 * The run coding a snapshot's columns are stored in.
 *
 * A column is cut into fixed-length runs and each run is compressed on its own.
 * Nothing smaller than a run is addressable, which is the point: a reader that
 * wants one crossing pays for one run, and a reader that wants none pays for
 * nothing. `openTestCoverage` stays a parse of the section index rather than a
 * decode of the file, and the two columns that dominate a large snapshot — the
 * crossings and the string blob — are never materialized whole.
 *
 * Numbers are delta coded before they are compressed. The columns this format
 * holds ascend almost everywhere — CSR offsets, the test ordinals inside one
 * region, byte offsets into the blob, line numbers down a file — and a delta of
 * those is a small number where the value was a large one. Deltas are zigzagged
 * because a delta is signed, and a decoder cannot tell a negative one from a
 * small positive one without a sign bit of its own.
 *
 * Brotli rather than zstd: `zlib.zstdCompressSync` arrived in Node 22.15 and
 * this package supports Node 22. Quality 4 rather than the default 11, which
 * costs an order of magnitude more time for a few per cent of size on data as
 * regular as this.
 */

/** Rows in one run of a column. */
export const RUN = 4096;

/**
 * Strings in one run of the blob.
 *
 * Smaller than a column's run because a run is what a single `string(id)` costs
 * and the calls that matter — a binary search over module paths — land in a
 * different run every time.
 */
export const BLOB_RUN = 512;

const RAW = 0;
const BROTLI = 1;
const HEAD = 4;
const QUALITY = 4;

/** Runs kept decompressed. A binary search probes fewer places than this. */
const CACHED = 8;

/** A column of numbers, read by the row or read whole. */
export interface WordColumn {
  readonly length: number;
  at(index: number): number;
  all(): Uint32Array;
}

/** A column of single bytes, read by the row or read whole. */
export interface ByteColumn {
  readonly length: number;
  at(index: number): number;
  all(): Uint8Array;
}

/**
 * What a column's values have to be true of, asked of one run at a time.
 *
 * `from` is the row the run's first value stands for, so a check that pairs two
 * columns — a region's last line against its first — reads the other by row
 * rather than materializing it.
 */
export type RunCheck<T> = (values: T, from: number) => void;

/** A numeric column as runs of deltas: `u32 count`, `u32 bound[count + 1]`, the runs. */
export function packWords(values: Uint32Array): Buffer {
  const runs: Buffer[] = [];
  for (let from = 0; from < values.length; from += RUN) {
    runs.push(compress(varints(values, from, Math.min(from + RUN, values.length))));
  }
  return laid(runs);
}

/** A byte column as runs. One byte per row is already a delta of nothing. */
export function packBytes(values: Uint8Array): Buffer {
  const runs: Buffer[] = [];
  for (let from = 0; from < values.length; from += RUN) {
    runs.push(compress(values.subarray(from, Math.min(from + RUN, values.length))));
  }
  return laid(runs);
}

/** The string blob as runs of whole strings, cut where the offset column says. */
export function packBlob(blob: Uint8Array, offsets: Uint32Array): Buffer {
  const strings = offsets.length - 1;
  const runs: Buffer[] = [];
  for (let first = 0; first < strings; first += BLOB_RUN) {
    runs.push(compress(blob.subarray(offsets[first]!, offsets[Math.min(first + BLOB_RUN, strings)]!)));
  }
  return laid(runs);
}

/** Read a numeric column, one run at a time. `check` sees each run as it decodes. */
export function openWords(
  section: Uint8Array,
  rows: number,
  check?: RunCheck<Uint32Array>,
): WordColumn {
  const runs = openRuns(section, rows, RUN);
  const held = cache<Uint32Array>();
  const read = (index: number): Uint32Array => {
    const values = unvarints(decompress(runs.at(index)), Math.min(RUN, rows - index * RUN));
    check?.(values, index * RUN);
    return values;
  };
  let whole: Uint32Array | undefined;
  const all = (): Uint32Array => {
    if (whole !== undefined) return whole;
    const values = new Uint32Array(rows);
    for (let index = 0; index < runs.count; index += 1) values.set(read(index), index * RUN);
    whole = values;
    return values;
  };
  return {
    length: rows,
    at: (index) => {
      if (index < 0 || index >= rows) fail();
      if (whole !== undefined) return whole[index]!;
      const value = held(Math.floor(index / RUN), read)[index % RUN]!;
      if (held.missed() > runs.count) all();
      return value;
    },
    all,
  };
}

/** Read a byte column, one run at a time. One byte per row is already a delta of nothing. */
export function openBytes(
  section: Uint8Array,
  rows: number,
  check?: RunCheck<Uint8Array>,
): ByteColumn {
  const runs = openRuns(section, rows, RUN);
  const held = cache<Uint8Array>();
  const read = (index: number): Uint8Array => {
    const values = decompress(runs.at(index));
    if (values.length !== Math.min(RUN, rows - index * RUN)) fail();
    check?.(values, index * RUN);
    return values;
  };
  let whole: Uint8Array | undefined;
  const all = (): Uint8Array => {
    if (whole !== undefined) return whole;
    const values = new Uint8Array(rows);
    for (let index = 0; index < runs.count; index += 1) values.set(read(index), index * RUN);
    whole = values;
    return values;
  };
  return {
    length: rows,
    at: (index) => {
      if (index < 0 || index >= rows) fail();
      if (whole !== undefined) return whole[index]!;
      const value = held(Math.floor(index / RUN), read)[index % RUN]!;
      if (held.missed() > runs.count) all();
      return value;
    },
    all,
  };
}

/**
 * Read one string's bytes out of a run-coded blob.
 *
 * The offsets are the column's own, absolute over the whole blob; a run begins
 * at the offset of its first string, which is what the two are subtracted for.
 */
export function openBlob(
  section: Uint8Array,
  offsets: () => Uint32Array,
): (id: number) => Uint8Array {
  const runs = openRuns(section, undefined, BLOB_RUN);
  const held = cache<Uint8Array>();
  let whole: Uint8Array | undefined;
  const all = (): Uint8Array => {
    const parts: Uint8Array[] = [];
    for (let index = 0; index < runs.count; index += 1) parts.push(decompress(runs.at(index)));
    whole = Buffer.concat(parts);
    return whole;
  };
  return (id) => {
    const at = offsets();
    const start = at[id];
    const end = at[id + 1];
    if (start === undefined || end === undefined) fail();
    if (whole !== undefined) {
      if (end > whole.length) fail();
      return whole.subarray(start, end);
    }
    const index = Math.floor(id / BLOB_RUN);
    const base = at[index * BLOB_RUN]!;
    const bytes = held(index, (run) => decompress(runs.at(run)));
    if (end - base > bytes.length) fail();
    const found = bytes.subarray(start - base, end - base);
    // The run this points into is its own array, so it stays an answer after
    // the blob behind it materializes.
    if (held.missed() > runs.count) all();
    return found;
  };
}

interface Runs {
  readonly count: number;
  at(index: number): Uint8Array;
}

function openRuns(section: Uint8Array, rows: number | undefined, per: number): Runs {
  if (section.length < HEAD) fail();
  const read = new DataView(section.buffer, section.byteOffset, section.byteLength);
  const count = read.getUint32(0, true);
  const payload = HEAD + (count + 1) * 4;
  if (payload > section.length) fail();
  if (rows !== undefined && count !== Math.ceil(rows / per)) fail();
  const bound = new Uint32Array(count + 1);
  for (let index = 0; index <= count; index += 1) bound[index] = read.getUint32(HEAD + index * 4, true);
  if (bound[0] !== 0 || bound[count] !== section.length - payload) fail();
  for (let index = 1; index <= count; index += 1) if (bound[index]! < bound[index - 1]!) fail();
  return {
    count,
    at: (index) => {
      const from = bound[index];
      const to = bound[index + 1];
      if (from === undefined || to === undefined) fail();
      return section.subarray(payload + from, payload + to);
    },
  };
}

/**
 * The last few runs read, and a count of the reads that were not among them.
 *
 * The count is what tells a column how it is being read. A caller walking rows
 * in order misses once per run and no more; a caller reaching all over the
 * column — a decode resolving every name a snapshot holds — misses on nearly
 * every read, and once it has missed more often than the column has runs it has
 * paid for the whole column already. Materializing then bounds the waste at
 * twice what reading it whole would have cost, and every read after it is free.
 */
function cache<T>(): {
  (index: number, make: (index: number) => T): T;
  readonly missed: () => number;
} {
  const held = new Map<number, T>();
  let missed = 0;
  return Object.assign(
    (index: number, make: (index: number) => T): T => {
      const found = held.get(index);
      if (found !== undefined) return found;
      missed += 1;
      const made = make(index);
      held.set(index, made);
      // Insertion order, so the first key is the least recently read in.
      if (held.size > CACHED) held.delete(held.keys().next().value!);
      return made;
    },
    { missed: () => missed },
  );
}

function laid(runs: readonly Buffer[]): Buffer {
  const bound = new Uint32Array(runs.length + 1);
  let at = 0;
  for (const [index, run] of runs.entries()) {
    bound[index] = at;
    at += run.length;
  }
  bound[runs.length] = at;
  const head = Buffer.alloc(HEAD);
  head.writeUInt32LE(runs.length);
  return Buffer.concat([head, Buffer.from(bound.buffer), ...runs]);
}

function compress(bytes: Uint8Array): Buffer {
  const packed = brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  });
  // Incompressible runs exist — a column of digest ids is close to random — and
  // storing one costs a byte rather than the expansion brotli would add.
  return packed.length < bytes.length
    ? Buffer.concat([Buffer.of(BROTLI), packed])
    : Buffer.concat([Buffer.of(RAW), bytes]);
}

function decompress(run: Uint8Array): Uint8Array {
  const tag = run[0];
  const body = run.subarray(1);
  if (tag === RAW) return body;
  if (tag !== BROTLI) fail();
  try {
    return brotliDecompressSync(body);
  } catch {
    // A stream this build did not write. The caller asked for a column of a
    // coverage artifact and what it has is not one, which is the same answer
    // every other malformed byte in the file gets.
    return fail();
  }
}

function varints(values: Uint32Array, from: number, to: number): Buffer {
  const out = Buffer.allocUnsafe((to - from) * 5);
  let at = 0;
  let previous = 0;
  for (let index = from; index < to; index += 1) {
    const value = values[index]!;
    const delta = value - previous;
    previous = value;
    let zigzag = ((delta << 1) ^ (delta >> 31)) >>> 0;
    while (zigzag > 0x7f) {
      out[at++] = (zigzag & 0x7f) | 0x80;
      zigzag >>>= 7;
    }
    out[at++] = zigzag;
  }
  return out.subarray(0, at);
}

function unvarints(bytes: Uint8Array, rows: number): Uint32Array {
  const out = new Uint32Array(rows);
  let at = 0;
  let previous = 0;
  for (let row = 0; row < rows; row += 1) {
    let raw = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[at];
      if (byte === undefined) fail();
      at += 1;
      raw |= (byte & 0x7f) << shift;
      if (byte < 0x80) break;
      shift += 7;
      if (shift > 28) fail();
    }
    // Modulo 2^32 throughout, which is what makes a delta over the whole
    // unsigned range decode back to the value it was taken from.
    previous = (previous + ((raw >>> 1) ^ -(raw & 1))) >>> 0;
    out[row] = previous;
  }
  if (at !== bytes.length) fail();
  return out;
}
