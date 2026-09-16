import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { fail } from './format-validation.js';

/**
 * The bytes one run of a column is made of, and nothing about columns.
 *
 * Everything here is per run and knows no more than that: a run is delta coded
 * and zigzagged, compressed if compressing it pays, and laid after its
 * neighbours behind a table of where each one starts. Which rows fall in which
 * run, and what a reader keeps hold of after decoding one, is the business of
 * `columns.ts`, which is the only caller.
 *
 * The seam is where the format's compatibility lives. A run carries its own
 * codec tag, so a change on this side is readable from the section index above
 * it without a reader knowing anything about the column it came out of.
 */

const RAW = 0;

/**
 * Tag 1 was brotli, and no file this build opens carries it: `FORMAT` moved
 * with the codec, so a snapshot written before it is refused at the header
 * rather than at a run. The number is not reused.
 */
const ZSTD = 2;

/** Bytes of run count before the table of run bounds. */
export const HEAD = 4;

/**
 * The levels, one per kind of run. Above these each stops paying: the varints
 * gain 9 KB across a whole snapshot between 6 and 9 for twice the time, and the
 * blob gets *larger* above 1.
 */
export const NUMBERS = 6;
export const TEXT = 1;

/** Runs behind a table of where each one starts, counted in the first word. */
export function laid(runs: readonly Buffer[]): Buffer {
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

export function compress(bytes: Uint8Array, level: number): Buffer {
  const packed = zstdCompressSync(bytes, {
    params: {
      [constants.ZSTD_c_compressionLevel]: level,
      [constants.ZSTD_c_contentSizeFlag]: 1,
    },
  });
  // Incompressible runs exist — a column of digest ids is close to random — and
  // storing one costs a byte rather than the expansion a frame would add.
  return packed.length < bytes.length
    ? Buffer.concat([Buffer.of(ZSTD), packed])
    : Buffer.concat([Buffer.of(RAW), bytes]);
}

export function decompress(run: Uint8Array): Uint8Array {
  const tag = run[0];
  const body = run.subarray(1);
  if (tag === RAW) return body;
  if (tag !== ZSTD) fail();
  try {
    return zstdDecompressSync(body);
  } catch {
    // A stream this build did not write. The caller asked for a column of a
    // coverage artifact and what it has is not one, which is the same answer
    // every other malformed byte in the file gets.
    return fail();
  }
}

export function varints(values: Uint32Array, from: number, to: number): Buffer {
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

export function unvarints(bytes: Uint8Array, rows: number): Uint32Array {
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
