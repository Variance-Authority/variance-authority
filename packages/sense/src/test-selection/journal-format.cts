/**
 * What one test file entered, as bytes.
 *
 * A journal is written from inside the test process, once per test file, at the
 * moment the file is done with — and read once, by the reporter, after every
 * worker has exited. Nothing else ever opens one: it is a transport between two
 * halves of the same run, not a record anyone keeps.
 *
 * That is exactly why it is not JSON. A run of eight thousand test files over a
 * two hundred thousand module repository hands the reporter sixteen million
 * module rows, and rendering those as text costs the workers time the suite is
 * charged for, the disk a gigabyte it has to find, and the reporter a parse into
 * sixteen million objects before the fold has begun. As frames it is a quarter
 * of the bytes and a quarter of the read, and the workers never build the
 * intermediate arrays at all — the counters go straight out as varints.
 *
 * CommonJS because of who loads it: Jest's setup file is evaluated inside the
 * sandbox from `node_modules`, where nothing is transformed and an ES `import`
 * would be a syntax error in every project that has not opted into ES modules.
 * The Vitest half and both reporters reach it through interop.
 *
 * There is no checksum. A journal is written by one process, closed, and read
 * by one reader after that process is gone, so the only damage a journal can
 * take is a tail that never arrived — and a decode that must land exactly on
 * the end of the frame refuses that without carrying four bytes per file to
 * find it out.
 */

import type { ModuleId } from '../instrument/index.js';
import type { ReadJournal } from './instrumented-modules.js';

/** `VAJRN` and a format version. A file that does not open with it is not one. */
const MAGIC = [0x56, 0x41, 0x4a, 0x52, 0x4e, 0x00, 0x00, 0x02];

/** No snapshot: nothing was counted before the file's first test. */
const NOTHING = new Uint32Array(0);

/**
 * A counter at or above this was incremented while its module was evaluating.
 *
 * Mirrors `EVALUATING` in `../instrument/index.ts`; a bare number because a
 * CommonJS file in the sandbox cannot import from an ES module.
 */
const EVALUATING = 0x80000000;

/** Numbered by the module table, or named by the path it was transformed under. */
const NUMBERED = 0;
const NAMED = 1;

/**
 * The counters as a frame, read straight out of the arrays the probes increment.
 *
 * No row objects and no ordinal arrays are built on the way: a module's
 * crossings are three passes over its `Uint32Array`, and what lands in the
 * buffer is the gap to the previous ordinal. Ordinals rise within a module and
 * the gaps are small, so a region costs one byte.
 *
 * `loaded` is the counters as they stood before the file's first test: a copy
 * the setup module takes in `beforeAll`, one per module the file had evaluated
 * by then. A module that arrived later has no copy and reports nothing there.
 * A copy of another length is a module whose text changed under the file, and
 * its ordinals name regions the live counters do not; it is read as nothing.
 */
function encodeJournal(
  testFile: string,
  modules: ReadonlyMap<ModuleId, Uint32Array>,
  loaded: ReadonlyMap<ModuleId, Uint32Array> = new Map(),
): Buffer {
  const out = new Writer();
  for (const byte of MAGIC) out.byte(byte);
  out.text(testFile);
  out.number(modules.size);
  for (const [id, counters] of modules) {
    if (typeof id === 'number') {
      out.byte(NUMBERED);
      out.number(id);
    } else {
      out.byte(NAMED);
      out.text(id);
    }
    entered(out, counters, 0);
    entered(out, counters, EVALUATING);
    const before = loaded.get(id);
    entered(out, before !== undefined && before.length === counters.length ? before : NOTHING, 0);
  }
  return out.done();
}

/** The ordinals whose counter reached `least`, as a count and then as gaps. */
function entered(out: Writer, counters: Uint32Array, least: number): void {
  let count = 0;
  for (const value of counters) if (value > 0 && value >= least) count += 1;
  out.number(count);
  let last = 0;
  for (let ordinal = 0; ordinal < counters.length; ordinal += 1) {
    const value = counters[ordinal]!;
    if (value === 0 || value < least) continue;
    out.number(ordinal - last);
    last = ordinal;
  }
}

/** A frame back as rows. Throws on anything that does not end where it says. */
function decodeJournal(raw: Uint8Array): ReadJournal {
  const read = new Reader(raw);
  for (const byte of MAGIC) if (read.byte() !== byte) throw damaged();
  const testFile = read.text();
  const count = read.number();
  const modules: Array<{ id: ModuleId; hits: number[]; shared: number[]; loaded: number[] }> = [];
  for (let index = 0; index < count; index += 1) {
    const tag = read.byte();
    if (tag !== NUMBERED && tag !== NAMED) throw damaged();
    const id = tag === NUMBERED ? read.number() : read.text();
    modules.push({ id, hits: read.ordinals(), shared: read.ordinals(), loaded: read.ordinals() });
  }
  if (!read.spent()) throw damaged();
  return { testFile, modules };
}

/**
 * What a reader of a frame is told, in the order the frame holds it.
 *
 * The three arrays a row hands over are windows onto one buffer the scan reuses
 * and mean nothing after the call returns: a reader that keeps what it was
 * given copies it. That is the point of reading this way — a run of eight
 * thousand files over a two hundred thousand module repository is sixteen
 * million rows, and a row that becomes an object is an object the fold has to
 * hold until the fold is over.
 */
interface JournalVisitor {
  /** The file this frame belongs to, before any row of it. */
  test(file: string): void;
  /**
   * Whether the rows of this module are wanted. A fold that works a slice of
   * the modules at a time says no to the rest, and their ordinals are stepped
   * over rather than decoded.
   */
  wants?(id: ModuleId): boolean;
  module(id: ModuleId, hits: Uint32Array, shared: Uint32Array, loaded: Uint32Array): void;
}

/**
 * A frame read without becoming rows: {@link decodeJournal} without the objects.
 *
 * Same bytes, same order, same refusal of a tail that never arrived. What it
 * does not do is allocate — one buffer for the ordinals, reused down the frame,
 * so what a scan costs is the frame and not the run.
 */
function scanJournal(raw: Uint8Array, visit: JournalVisitor): void {
  const read = new Reader(raw);
  for (const byte of MAGIC) if (read.byte() !== byte) throw damaged();
  visit.test(read.text());
  const count = read.number();
  const wants = visit.wants;
  let scratch = new Uint32Array(64);
  for (let index = 0; index < count; index += 1) {
    const tag = read.byte();
    if (tag !== NUMBERED && tag !== NAMED) throw damaged();
    const id = tag === NUMBERED ? read.number() : read.text();
    if (wants !== undefined && !wants.call(visit, id)) {
      read.skip();
      read.skip();
      read.skip();
      continue;
    }
    let held = 0;
    const runs: number[] = [];
    for (let run = 0; run < 3; run += 1) {
      const length = read.number();
      if (held + length > scratch.length) {
        const grown = new Uint32Array(1 << (32 - Math.clz32(held + length - 1)));
        grown.set(scratch.subarray(0, held));
        scratch = grown;
      }
      read.into(scratch, held, length);
      runs.push(held);
      held += length;
    }
    visit.module(
      id,
      scratch.subarray(runs[0]!, runs[1]!),
      scratch.subarray(runs[1]!, runs[2]!),
      scratch.subarray(runs[2]!, held),
    );
  }
  if (!read.spent()) throw damaged();
}

const damaged = (): Error => new Error('not a variance-authority journal');

/** Bytes out, growing by doubling; a varint is seven bits a byte, low first. */
class Writer {
  #bytes = Buffer.allocUnsafe(1 << 12);
  #at = 0;

  byte(value: number): void {
    this.#room(1);
    this.#bytes[this.#at++] = value;
  }

  number(value: number): void {
    this.#room(5);
    let rest = value;
    while (rest > 0x7f) {
      this.#bytes[this.#at++] = (rest & 0x7f) | 0x80;
      rest >>>= 7;
    }
    this.#bytes[this.#at++] = rest;
  }

  text(value: string): void {
    const length = Buffer.byteLength(value, 'utf8');
    this.number(length);
    this.#room(length);
    this.#bytes.write(value, this.#at, 'utf8');
    this.#at += length;
  }

  done(): Buffer {
    return this.#bytes.subarray(0, this.#at);
  }

  #room(bytes: number): void {
    if (this.#at + bytes <= this.#bytes.length) return;
    let length = this.#bytes.length * 2;
    while (length < this.#at + bytes) length *= 2;
    const grown = Buffer.allocUnsafe(length);
    this.#bytes.copy(grown, 0, 0, this.#at);
    this.#bytes = grown;
  }
}

/** Bytes in. Every read is bounded, so a truncated frame throws rather than guesses. */
class Reader {
  readonly #bytes: Buffer;
  #at = 0;

  constructor(raw: Uint8Array) {
    this.#bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  }

  byte(): number {
    if (this.#at >= this.#bytes.length) throw damaged();
    return this.#bytes[this.#at++]!;
  }

  number(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = this.byte();
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
      if (shift > 28) throw damaged();
    }
  }

  text(): string {
    const length = this.number();
    if (this.#at + length > this.#bytes.length) throw damaged();
    const value = this.#bytes.toString('utf8', this.#at, this.#at + length);
    this.#at += length;
    return value;
  }

  /** A run of gaps, accumulated into the ordinals they name. */
  into(values: Uint32Array, at: number, count: number): void {
    if (this.#at + count > this.#bytes.length) throw damaged();
    let last = 0;
    for (let index = 0; index < count; index += 1) {
      last += this.number();
      values[at + index] = last;
    }
  }

  /** A run stepped over: its varints are found by their last byte, not read. */
  skip(): void {
    let count = this.number();
    while (count > 0) {
      if ((this.byte() & 0x80) === 0) count -= 1;
    }
  }

  ordinals(): number[] {
    const count = this.number();
    if (this.#at + count > this.#bytes.length) throw damaged();
    const values: number[] = [];
    let last = 0;
    for (let index = 0; index < count; index += 1) {
      last += this.number();
      values.push(last);
    }
    return values;
  }

  spent(): boolean {
    return this.#at === this.#bytes.length;
  }
}

export = { encodeJournal, decodeJournal, scanJournal };
