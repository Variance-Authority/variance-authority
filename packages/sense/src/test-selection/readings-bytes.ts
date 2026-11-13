/**
 * The bytes of the `cases.readings` section (`case-readings.ts`).
 *
 * Every number is an unsigned varint of at most five bytes, as the case lines
 * write it, and a string is its UTF-8 length then its bytes. The section is a
 * count of cases, each its id and the length of its bytes then the bytes, in
 * id order; then a count of test files, each its path and its inputs' digest,
 * in path order. An id and a path are each the count of bytes it shares with
 * the one before it, then the rest as a string; a `v1:` digest is its hex's
 * byte count then those bytes, and any other is a zero then the digest.
 * A case's bytes stand alone, so a fold of shards compares them without
 * reading them: a count of strings and the strings, each module, name and path
 * once in the order its readings first name it; then a count of readings and
 * each reading: its count, its flags, and the parts the flags say it holds.
 * A region is its module's, name's and path's string, its start and end line,
 * and its value plus one, zero for none.
 */

import { put, varints } from './varints.js';

/** One region a reading crossed: its module, its declaration's name and the path in it, its lines, and the value cadence charged it; null where no line was recorded. */
export type ReadRegion = readonly [module: string, name: string, path: string, startLine: number, endLine: number, value: number | null];

/** A reading as stored: see `case-readings.ts`. */
export interface StoredReading {
  readonly count: number;
  readonly stopped?: boolean;
  readonly regions?: readonly ReadRegion[];
  readonly gone?: readonly number[];
  readonly values?: readonly (readonly [at: number, value: number | null])[];
  readonly added?: readonly (readonly [at: number, region: ReadRegion])[];
}

/** A digest as `@variance-authority/core` spells it (`format/hash.ts`): stored as its bytes. */
const DIGEST = /^v1:((?:[0-9a-f]{2})+)$/;

const STOPPED = 1;
const STOPS = 2;
const REGIONS = 4;
const GONE = 8;
const VALUES = 16;
const ADDED = 32;

/** The section: each case's stored readings, in id order, and each test file's inputs, in file order. */
export function encodeReadings(cases: readonly (readonly [string, readonly StoredReading[]])[], inputs: readonly (readonly [string, string])[]): Buffer {
  const out: number[] = [];
  const id = fronted(out);
  put(out, cases.length);
  for (const [case_, readings] of cases) {
    id(case_);
    const own = encodeCase(readings);
    put(out, own.length);
    for (const byte of own) out.push(byte);
  }
  const path = fronted(out);
  put(out, inputs.length);
  for (const [file, digest] of inputs) {
    path(file);
    const hex = DIGEST.exec(digest)?.[1];
    put(out, hex === undefined ? 0 : hex.length / 2);
    if (hex === undefined) text(out, digest);
    else for (const byte of Buffer.from(hex, 'hex')) out.push(byte);
  }
  return Buffer.from(out);
}

/**
 * The section's cases, each its bytes for {@link decodeCase}, and its inputs.
 * A section `encodeReadings` did not write, such as one an earlier build wrote
 * as JSON, holds none: the readings are only what earlier runs saw, and the
 * next record writes them again.
 */
export function decodeReadings(bytes: Uint8Array | undefined): { readonly cases: Map<string, Uint8Array>; readonly inputs: Map<string, string> } {
  const cases = new Map<string, Uint8Array>();
  const inputs = new Map<string, string>();
  if (bytes === undefined) return { cases, inputs };
  try {
    const read = reader(bytes);
    const id = read.fronted();
    for (let count = read.take(); count > 0; count--) {
      const case_ = id();
      cases.set(case_, read.bytes(read.take()));
    }
    const path = read.fronted();
    for (let count = read.take(); count > 0; count--) {
      const file = path();
      const length = read.take();
      inputs.set(file, length === 0 ? read.text() : `v1:${read.hex(length)}`);
    }
    read.end();
    return { cases, inputs };
  } catch {
    return { cases: new Map(), inputs: new Map() };
  }
}

/** One case's stored readings off its bytes, which the section's frame already accepted. */
export function decodeCase(bytes: Uint8Array): StoredReading[] {
  const read = reader(bytes);
  const strings: string[] = [];
  for (let count = read.take(); strings.length < count;) strings.push(read.text());
  const string = (): string => strings[read.take()] ?? invalid();
  const value = (): number | null => {
    const held = read.take();
    return held === 0 ? null : held - 1;
  };
  const region = (): ReadRegion => [string(), string(), string(), read.take(), read.take(), value()];
  const list = <T>(each: () => T): T[] => Array.from({ length: read.take() }, each);
  const readings: StoredReading[] = [];
  for (let count = read.take(); readings.length < count;) {
    const reading: { -readonly [K in keyof StoredReading]: StoredReading[K] } = { count: read.take() };
    const flags = read.take();
    if (flags & STOPPED) reading.stopped = (flags & STOPS) !== 0;
    if (flags & REGIONS) reading.regions = list(region);
    if (flags & GONE) {
      let at = -1;
      reading.gone = list(() => (at += read.take() + 1));
    }
    if (flags & VALUES) reading.values = list(() => [read.take(), value()] as const);
    if (flags & ADDED) reading.added = list(() => [read.take(), region()] as const);
    readings.push(reading);
  }
  read.end();
  return readings;
}

function encodeCase(readings: readonly StoredReading[]): number[] {
  const strings = new Map<string, number>();
  const body: number[] = [];
  const string = (value: string): void => {
    if (!strings.has(value)) strings.set(value, strings.size);
    put(body, strings.get(value)!);
  };
  const value = (held: number | null): void => put(body, held === null ? 0 : held + 1);
  const region = ([module, name, path, start, end, held]: ReadRegion): void => {
    string(module);
    string(name);
    string(path);
    put(body, start);
    put(body, end);
    value(held);
  };
  put(body, readings.length);
  for (const { count, stopped, regions, gone, values, added } of readings) {
    put(body, count);
    put(body, (stopped === undefined ? 0 : STOPPED | (stopped ? STOPS : 0))
      | (regions === undefined ? 0 : REGIONS) | (gone === undefined ? 0 : GONE)
      | (values === undefined ? 0 : VALUES) | (added === undefined ? 0 : ADDED));
    if (regions !== undefined) {
      put(body, regions.length);
      regions.forEach(region);
    }
    if (gone !== undefined) {
      put(body, gone.length);
      gone.forEach((at, place) => put(body, at - (place === 0 ? -1 : gone[place - 1]!) - 1));
    }
    if (values !== undefined) {
      put(body, values.length);
      for (const [at, held] of values) {
        put(body, at);
        value(held);
      }
    }
    if (added !== undefined) {
      put(body, added.length);
      for (const [at, held] of added) {
        put(body, at);
        region(held);
      }
    }
  }
  const out: number[] = [];
  put(out, strings.size);
  for (const value of strings.keys()) text(out, value);
  for (const byte of body) out.push(byte);
  return out;
}

interface Reader {
  take(): number;
  bytes(length: number): Uint8Array;
  text(): string;
  hex(length: number): string;
  fronted(): () => string;
  end(): void;
}

function reader(bytes: Uint8Array): Reader {
  const read = varints(bytes, refused);
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (held: Uint8Array): number => held.byteOffset - bytes.byteOffset;
  const spelled = (encoding: 'utf8' | 'hex', held: Uint8Array): string => view.toString(encoding, at(held), at(held) + held.byteLength);
  return {
    take: read.take,
    bytes: read.bytes,
    text: () => spelled('utf8', read.bytes(read.take())),
    hex: (length) => spelled('hex', read.bytes(length)),
    fronted: () => {
      let last: Buffer = Buffer.alloc(0);
      return () => {
        const shared = read.take();
        if (shared > last.length) invalid();
        const rest = read.bytes(read.take());
        if (shared === 0) {
          last = view.subarray(at(rest), at(rest) + rest.byteLength);
          return spelled('utf8', rest);
        }
        const whole = Buffer.allocUnsafe(shared + rest.byteLength);
        last.copy(whole, 0, 0, shared);
        view.copy(whole, shared, at(rest), at(rest) + rest.byteLength);
        last = whole;
        return whole.toString('utf8');
      };
    },
    end: () => void (read.done || invalid()),
  };
}

/** A writer of strings in order, each the bytes it shares with the one before and the rest. */
function fronted(out: number[]): (value: string) => void {
  let last = Buffer.alloc(0);
  return (value) => {
    const bytes = Buffer.from(value, 'utf8');
    let shared = 0;
    while (shared < bytes.length && shared < last.length && bytes[shared] === last[shared]) shared++;
    put(out, shared);
    put(out, bytes.length - shared);
    for (let at = shared; at < bytes.length; at++) out.push(bytes[at]!);
    last = bytes;
  };
}

function text(out: number[], value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  put(out, bytes.length);
  for (const byte of bytes) out.push(byte);
}

function invalid(): never {
  throw refused();
}

function refused(): Error {
  return new Error('the record\'s readings section is not one this build reads');
}
