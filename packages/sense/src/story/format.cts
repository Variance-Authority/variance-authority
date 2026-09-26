/**
 * A story on disk: the regions one case visited, in the order it visited them.
 *
 * A journey is the set of places a case reached, and it is what every other
 * part of the recording is built from. A story is the tape
 * [`story-tap.cts`](../instrument/story-tap.cts) keeps beside it when somebody
 * runs with `VARIANCE_AUTHORITY_STORY=1`, cut to one case. Nothing selects on
 * it, compares it or folds it into a record: it is written for the person or
 * agent reading one case, and it is read back only by `variance story`.
 *
 * ## Layout
 *
 * ```
 * magic      VASTRY\0\1                     8 bytes
 * header     u32 length, then UTF-8 JSON    padded to 4
 * visits     i32 each                       before, then the case
 * ```
 *
 * The header says which file and case the story is, the rows it uses as
 * `[module, block count]`, how many of the visits came before the case, and
 * what the tape could not keep. A visit is a region's index in the story's own
 * row table — the realm's indices are the order modules happened to register
 * in, which means nothing outside the run — with the evaluating bit kept as the
 * sign bit, as the probe wrote it.
 *
 * ## What comes before a case
 *
 * The visits in no case's bucket immediately before the case began: the last
 * case's `afterEach` and this one's `beforeEach`, whichever the runner ran
 * outside the case's bracket. A reader labels them as before the case and never
 * as the case.
 *
 * CommonJS so the collectors can require it from inside a runner's sandbox,
 * for the reason `journal-format.cts` is.
 */

import crypto = require('node:crypto');
import fs = require('node:fs');
import path = require('node:path');
import journals = require('../test-selection/journal-format.cjs');
import type { ModuleId } from '../instrument/index.js';
import type storyTap = require('../instrument/story-tap.cjs');

type Tape = ReturnType<ReturnType<typeof storyTap.createTap>['read']>;

const MAGIC = [0x56, 0x41, 0x53, 0x54, 0x52, 0x59, 0x00, 0x01];
const EVALUATING = -2147483648;
const INDEX = 0x7fffffff;

/** A story read back. */
interface Story {
  /** The test file, as the runner named it. */
  readonly file: string;
  /** The case, as the runner named it: `describe > case`. */
  readonly name: string;
  /** `[module, block count]` for every module a visit names, in first-visit order. */
  readonly rows: readonly (readonly [ModuleId, number])[];
  /** What ran outside any case just before this one began. */
  readonly before: Int32Array;
  /** What ran in the case, in order. */
  readonly visits: Int32Array;
  /**
   * Visits made after the tape stopped, in this case or another since the tape
   * last started. Zero is a tape that kept everything.
   */
  readonly untaped: number;
  /**
   * How many times another case's work ran in the middle of this one's. Only
   * a run that follows cases through the async context can see it; elsewhere it
   * is zero because one case runs at a time.
   */
  readonly interleaved: number;
  /** Whether the case's body threw or rejected; absent where the collector could not see it settle. */
  readonly stopped?: boolean;
}

/** Where a case's story is written: one name per file and case, so a later run replaces it. */
function storyName(file: string, name: string): string {
  return `${crypto.createHash('sha256').update(`${file}\u0000${name}`).digest('hex').slice(0, 32)}.story`;
}

/**
 * The story of the case keyed `key` on `tape`.
 *
 * A case that visited no instrumented region still has a story, and it is an
 * empty one: the case ran under the flag and reached nothing the run records.
 * Writing nothing would read the same as a run without the flag. What came
 * before such a case is not told, because a case with no visit has no place on
 * the tape to begin.
 */
function encodeStory(tape: Tape, key: string, stopped?: boolean): Buffer {
  const { at, keys } = tape;
  const ends = (segment: number): number => (segment + 1 < at.length ? at[segment + 1]! : tape.taped);
  const own: number[] = [];
  let interleaved = 0;
  let foreign = 0;
  for (let segment = 0; segment < keys.length; segment += 1) {
    if (keys[segment] === key) {
      if (own.length > 0 && foreign > 0) interleaved += 1;
      foreign = 0;
      own.push(segment);
    } else if (own.length > 0 && keys[segment] !== '') foreign += 1;
  }
  let first = own[0] ?? keys.length;
  while (own.length > 0 && first > 0 && keys[first - 1] === '') first -= 1;

  const bases = tape.rows.bases;
  const dense = new Map<number, number>();
  const rows: [ModuleId, number][] = [];
  let total = 0;
  const entries: number[] = [];
  const take = (from: number, to: number): void => {
    for (let at = from; at < to; at += 1) {
      const entry = tape.tape[at]!;
      const index = entry & INDEX;
      let low = 0;
      let high = bases.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (bases[middle]! <= index) low = middle;
        else high = middle - 1;
      }
      let base = dense.get(low);
      if (base === undefined) {
        base = total;
        dense.set(low, base);
        rows.push([tape.rows.ids[low]!, tape.rows.counts[low]!]);
        total += tape.rows.counts[low]!;
      }
      entries.push((base + index - bases[low]!) | (entry & EVALUATING));
    }
  };
  for (let segment = first; segment < (own[0] ?? first); segment += 1) take(at[segment]!, ends(segment));
  const before = entries.length;
  for (const segment of own) take(at[segment]!, ends(segment));

  const { file, name } = journals.unpackCase(key);
  const header = Buffer.from(
    JSON.stringify({ file, name, rows, before, untaped: tape.visits - tape.taped, interleaved, stopped }),
    'utf8',
  );
  const padded = (header.length + 3) & ~3;
  const out = Buffer.alloc(MAGIC.length + 4 + padded + entries.length * 4, 0x20);
  out.set(MAGIC, 0);
  out.writeUInt32LE(header.length, MAGIC.length);
  header.copy(out, MAGIC.length + 4);
  const body = MAGIC.length + 4 + padded;
  for (let at = 0; at < entries.length; at += 1) out.writeInt32LE(entries[at]!, body + at * 4);
  return out;
}

/** A story's bytes read back, or an error naming what they are not. */
function decodeStory(bytes: Uint8Array): Story {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const damaged = (): Error => new Error('variance-authority: this is not a story this build writes');
  if (buffer.length < MAGIC.length + 4) throw damaged();
  for (let at = 0; at < MAGIC.length; at += 1) if (buffer[at] !== MAGIC[at]) throw damaged();
  const length = buffer.readUInt32LE(MAGIC.length);
  const body = MAGIC.length + 4 + ((length + 3) & ~3);
  if (body > buffer.length || (buffer.length - body) % 4 !== 0) throw damaged();
  const header = JSON.parse(buffer.toString('utf8', MAGIC.length + 4, MAGIC.length + 4 + length)) as Omit<
    Story,
    'before' | 'visits'
  > & { before: number };
  const all = new Int32Array((buffer.length - body) / 4);
  for (let at = 0; at < all.length; at += 1) all[at] = buffer.readInt32LE(body + at * 4);
  return { ...header, before: all.subarray(0, header.before), visits: all.subarray(header.before) };
}

/** What a collector hands a story to: one file per case in `directory`, the last write kept. */
function storyWriter(directory: string): (key: string, bytes: Uint8Array) => void {
  return (key, bytes) => {
    const { file, name } = journals.unpackCase(key);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, storyName(file, name)), bytes);
  };
}

export = { storyName, storyWriter, encodeStory, decodeStory, EVALUATING };
