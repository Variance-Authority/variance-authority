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

import { varints } from './varints.js';

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

/** A reading's flags: which parts it holds. */
export const STOPPED = 1;
export const STOPS = 2;
export const REGIONS = 4;
export const GONE = 8;
export const VALUES = 16;
export const ADDED = 32;

/**
 * The section's cases, each its bytes for {@link decodeCase}, and its inputs.
 * A section an earlier build wrote as JSON holds none: the readings are only
 * what earlier runs saw, and the next record writes them as bytes. Bytes this
 * build cannot read are refused, so a damaged section never passes for empty.
 */
export function decodeReadings(bytes: Uint8Array | undefined): { readonly cases: Map<string, Uint8Array>; readonly inputs: Map<string, string> } {
  const cases = new Map<string, Uint8Array>();
  const inputs = new Map<string, string>();
  if (bytes === undefined || isJson(bytes)) return { cases, inputs };
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
}

/** An object as `JSON.stringify` opens it, `{"`: a section of bytes opens with a count then a shared count of 0. */
function isJson(bytes: Uint8Array): boolean {
  return bytes[0] === 0x7b && bytes[1] === 0x22;
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
  // Every item takes a byte at least, so a count past what is left is refused before room is made for it.
  const list = <T>(each: () => T): T[] => {
    const count = read.take();
    return count > read.left ? invalid() : Array.from({ length: count }, each);
  };
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

interface Reader {
  take(): number;
  bytes(length: number): Uint8Array;
  readonly left: number;
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
    get left() {
      return read.left;
    },
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

function invalid(): never {
  throw refused();
}

function refused(): Error {
  return new Error('the record\'s readings section is not one this build reads');
}
