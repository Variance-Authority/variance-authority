import {
  HEAD,
  NUMBERS,
  TEXT,
  compress,
  decompress,
  laid,
  unvarints,
  varints,
} from './column-codec.js';
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
 * Zstd, at two levels, because the runs are two kinds of data. A varint run is
 * a dense stream of small integers and answers to a long search; a run of the
 * blob is file paths and hex digests, which zstd finds most of at level 1 and
 * nothing more of above it. Measured over a 20,000 module snapshot, against the
 * brotli quality 4 this replaced: 319 ms to compress became 120 ms, and the
 * file got 86 KB smaller.
 *
 * Zstd rather than brotli: the same 20,000 columns cost brotli 187 ms on the
 * blob alone, for 7.169 MB against zstd's 7.083 MB in 30 ms. Brotli's static
 * dictionary is tuned for markup, and above quality 4 it made this blob larger
 * rather than smaller. `zlib.zstdCompressSync` arrived in Node 22.15, which is
 * why this package's floor is that and not 22.
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

/**
 * Runs kept decompressed however large they are.
 *
 * A floor rather than the bound: a column of a few enormous runs still answers
 * a search that walks between a handful of them, and {@link HELD} is what stops
 * a column of small ones from keeping the file.
 */
const CACHED = 8;

/**
 * Decompressed bytes one column keeps hold of, past the floor above.
 *
 * A binary search does not return to the last few places it probed. It returns
 * to the *first* few: every search starts at the middle of the column, and the
 * top of that tree is the same handful of rows whoever is being looked up. Over
 * a 1,910,132 string dictionary in 3,731 runs, every `variance select` measured
 * here touched 409 to 418 distinct runs and no more — 11% of the column, the
 * same 11% at 300 changed files and at 6,000. Eight runs cannot hold that, so
 * each of the 418 was decompressed and dropped and decompressed again: 83,040
 * decodes at 6,000 changed files for 418 runs of work.
 *
 * Sixteen megabytes holds the whole of that hot set — 418 runs of the blob is
 * 8.2 MB — and bounds what a column that is being read some other way can keep.
 * A sequential scan of the largest table a snapshot holds never revisits a run
 * at all, so what it holds is dead weight, and this is the cap on that weight.
 */
const HELD = 16 * 1024 * 1024;

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
 * The bytes one section is stored in, wherever they are.
 *
 * A column addresses its runs by offset and never wants the section whole, so
 * what it needs of the file is a range at a time — which a resident buffer
 * answers with a subarray and a file on disk answers with a read. The columns
 * below are written against this and not against a buffer, so the same reader
 * serves a snapshot somebody already holds and one that stays where it is.
 */
export interface Bytes {
  readonly length: number;
  /** The bytes in `[from, to)`. Its own array when the section is not resident. */
  read(from: number, to: number): Uint8Array;
}

/** Bytes already in memory, answering the same door. */
export function resident(bytes: Uint8Array): Bytes {
  return { length: bytes.length, read: (from, to) => bytes.subarray(from, to) };
}

/**
 * Where a blob's cuts come from, asked one at a time.
 *
 * A read wants three offsets — the string's two ends, and the start of the run
 * it sits in — and all three are within one run of the offset column of each
 * other, so asking that column by the row costs one run of it. Asking it for
 * the array materialized it instead: a single `string(id)` against a two
 * million string dictionary decompressed all 467 runs of `strings.off`, 7.6 MB,
 * to answer one name. A thunk is still taken, because a caller that already
 * holds the offsets has nothing to gain by handing over a column that would
 * index them.
 */
export type Offsets = Pick<WordColumn, 'at'> | (() => Uint32Array);

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
    runs.push(compress(varints(values, from, Math.min(from + RUN, values.length)), NUMBERS));
  }
  return laid(runs);
}

/** A byte column as runs. One byte per row is already a delta of nothing. */
export function packBytes(values: Uint8Array): Buffer {
  const runs: Buffer[] = [];
  for (let from = 0; from < values.length; from += RUN) {
    runs.push(compress(values.subarray(from, Math.min(from + RUN, values.length)), NUMBERS));
  }
  return laid(runs);
}

/** The string blob as runs of whole strings, cut where the offset column says. */
export function packBlob(blob: Uint8Array, offsets: Uint32Array): Buffer {
  const strings = offsets.length - 1;
  const runs: Buffer[] = [];
  for (let first = 0; first < strings; first += BLOB_RUN) {
    runs.push(compress(blob.subarray(offsets[first]!, offsets[Math.min(first + BLOB_RUN, strings)]!), TEXT));
  }
  return laid(runs);
}

/** Read a numeric column, one run at a time. `check` sees each run as it decodes. */
export function openWords(
  section: Bytes | Uint8Array,
  rows: number,
  check?: RunCheck<Uint32Array>,
): WordColumn {
  const runs = openRuns(section, rows, RUN);
  const held = cache<Uint32Array>(runs.count);
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
      if (held.overpaid()) all();
      return value;
    },
    all,
  };
}

/** Read a byte column, one run at a time. One byte per row is already a delta of nothing. */
export function openBytes(
  section: Bytes | Uint8Array,
  rows: number,
  check?: RunCheck<Uint8Array>,
): ByteColumn {
  const runs = openRuns(section, rows, RUN);
  const held = cache<Uint8Array>(runs.count);
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
      if (held.overpaid()) all();
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
export interface Blob {
  (id: number): Uint8Array;
  /** Every string's bytes end to end, which is what the offsets already cut. */
  all(): Uint8Array;
}

export function openBlob(section: Bytes | Uint8Array, offsets: Offsets): Blob {
  const runs = openRuns(section, undefined, BLOB_RUN);
  const held = cache<Uint8Array>(runs.count);
  const cut = cuts(offsets);
  let whole: Uint8Array | undefined;
  const all = (): Uint8Array => {
    const parts: Uint8Array[] = [];
    for (let index = 0; index < runs.count; index += 1) parts.push(decompress(runs.at(index)));
    whole = Buffer.concat(parts);
    return whole;
  };
  const read = (id: number): Uint8Array => {
    const start = cut(id);
    const end = cut(id + 1);
    // The bounds were a fact about the whole offset column, proved when
    // something materialized it. Read one at a time they are three numbers, and
    // what a reader needs of them is what it is about to index with.
    if (end < start) fail();
    if (whole !== undefined) {
      if (end > whole.length) fail();
      return whole.subarray(start, end);
    }
    const index = Math.floor(id / BLOB_RUN);
    const base = cut(index * BLOB_RUN);
    const bytes = held(index, (run) => decompress(runs.at(run)));
    if (start < base || end - base > bytes.length) fail();
    const found = bytes.subarray(start - base, end - base);
    // The run this points into is its own array, so it stays an answer after
    // the blob behind it materializes.
    if (held.overpaid()) all();
    return found;
  };
  return Object.assign(read, { all: (): Uint8Array => whole ?? all() });
}

/** One offset, however the caller spelled where they come from. */
function cuts(offsets: Offsets): (index: number) => number {
  if (typeof offsets !== 'function') return (index) => offsets.at(index);
  return (index) => {
    const value = offsets()[index];
    if (value === undefined) fail();
    return value;
  };
}

interface Runs {
  readonly count: number;
  at(index: number): Uint8Array;
}

function openRuns(section: Bytes | Uint8Array, rows: number | undefined, per: number): Runs {
  const held = section instanceof Uint8Array ? resident(section) : section;
  if (held.length < HEAD) fail();
  const head = held.read(0, HEAD);
  const count = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(0, true);
  const payload = HEAD + (count + 1) * 4;
  if (payload > held.length) fail();
  if (rows !== undefined && count !== Math.ceil(rows / per)) fail();
  const index = held.read(HEAD, payload);
  const read = new DataView(index.buffer, index.byteOffset, index.byteLength);
  const bound = new Uint32Array(count + 1);
  for (let run = 0; run <= count; run += 1) bound[run] = read.getUint32(run * 4, true);
  if (bound[0] !== 0 || bound[count] !== held.length - payload) fail();
  for (let run = 1; run <= count; run += 1) if (bound[run]! < bound[run - 1]!) fail();
  return {
    count,
    at: (run) => {
      const from = bound[run];
      const to = bound[run + 1];
      if (from === undefined || to === undefined) fail();
      return held.read(payload + from, payload + to);
    },
  };
}

/**
 * The runs a column has decompressed lately, and whether it has now decompressed
 * all of them and started over.
 *
 * What the count is for is telling a column how it is being read, and what it
 * counts has to be waste rather than work. A caller walking rows in order
 * decodes each run once and never comes back to it: nothing it does is wasted,
 * however many runs it reads. A caller reaching all over the column — a decode
 * resolving every name a snapshot holds — comes back to runs it decoded and
 * dropped, and once it has decoded the whole column and then paid for it over
 * again, materializing bounds the waste and every read after it is free.
 *
 * Counting *misses* instead — a read that was not among the few held — put the
 * cliff in two wrong places. A sequential scan misses exactly once per run and
 * wastes nothing, so the largest table a snapshot holds, one row per test per
 * precondition and a hundred million rows at a repository's scale, sat a single
 * read below materializing 413 MB of it. And a binary search probes about
 * `log2(rows)` places, which on a column of a few thousand rows is more places
 * than the column has runs, so the cheapest question in the format tripped it on
 * the way to reading twenty rows.
 *
 * ## Why repeats alone are not enough either
 *
 * Counting only repeats put the cliff in a third wrong place, and this one shows
 * up on an ordinary working day. A binary search over a sorted dictionary lands
 * in a different run on nearly every probe, and the runs it comes back to across
 * one lookup and the next are the top of the search tree — a few hundred of
 * them, held by nothing, decoded and dropped and decoded again. Repeats climb
 * with the number of lookups while the part of the column anyone wants does not
 * move at all: measured over the 1,910,132 string dictionary of a 200,000 module
 * snapshot, `variance select` touched 409 distinct runs of 3,731 at 300 changed
 * files and 418 at 6,000 — 11% either way — and repeated 5,015 and 82,622 times.
 * Repeats passed the column's own run count somewhere around 300 changed files,
 * and the reader materialized 70.9 MB of dictionary to serve 11% of it: peak
 * resident went from 384 MB at 200 changed files to 552 MB at 300, a step rather
 * than a slope, and 840 MB at 6,000 against a 600 MB ceiling.
 *
 * So both halves are asked for. `repeated` says the waste is real, and the count
 * of *distinct* runs says the column is genuinely wanted whole rather than
 * hammered in one corner — which is the thing repeats were being read as
 * evidence of and are not. A reader that never decodes the last run never
 * materializes, and pays for the corner it is in and nothing else.
 */
function cache<T extends { readonly byteLength: number }>(
  runs: number,
): {
  (index: number, make: (index: number) => T): T;
  /** The whole column decoded once, and then paid for over again. */
  readonly overpaid: () => boolean;
} {
  const held = new Map<number, T>();
  let bytes = 0;
  // One bit per run, against the megabytes the column itself would cost: the
  // only thing that tells a run being decoded again from one being decoded.
  // Allocated on the first read, so opening a column stays free.
  let seen: Uint8Array | undefined;
  let decoded = 0;
  let repeated = 0;
  return Object.assign(
    (index: number, make: (index: number) => T): T => {
      const found = held.get(index);
      if (found !== undefined) {
        // Insertion order is eviction order, so a read puts its run at the back
        // and the front is the least recently read of them.
        held.delete(index);
        held.set(index, found);
        return found;
      }
      seen ??= new Uint8Array(Math.ceil(runs / 8));
      const word = index >> 3;
      const bit = 1 << (index & 7);
      if (((seen[word] ?? 0) & bit) !== 0) repeated += 1;
      else decoded += 1;
      seen[word] = (seen[word] ?? 0) | bit;
      const made = make(index);
      held.set(index, made);
      bytes += made.byteLength;
      while (held.size > CACHED && bytes > HELD) {
        const oldest = held.keys().next().value!;
        bytes -= held.get(oldest)!.byteLength;
        held.delete(oldest);
      }
      return made;
    },
    { overpaid: () => decoded >= runs && repeated > runs },
  );
}
