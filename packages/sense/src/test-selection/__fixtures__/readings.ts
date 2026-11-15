import { ADDED, decodeReadings, GONE, REGIONS, STOPPED, STOPS, VALUES, type ReadRegion, type StoredReading } from '../readings-bytes.js';
import { put, varints } from '../varints.js';

/** A digest as `@variance-authority/core` spells it (`format/hash.ts`): stored as its bytes. */
const DIGEST = /^v1:((?:[0-9a-f]{2})+)$/;

/** A readings section as plain values: each case's stored readings, and each test file's inputs. */
export interface ReadingsShape {
  readonly cases?: Readonly<Record<string, readonly StoredReading[]>>;
  readonly inputs?: Readonly<Record<string, string>>;
}

/** The section `shape` names, as `layReadings` writes it. */
export function sectionOf(shape: ReadingsShape): Buffer {
  return encodeReadings(Object.entries(shape.cases ?? {}), Object.entries(shape.inputs ?? {}));
}

/** The section's bytes as plain values, a part it holds none of left out. */
export function shapeOf(section: Uint8Array): ReadingsShape {
  const { cases, inputs } = decodeReadings(section);
  return {
    ...(cases.size === 0 ? {} : { cases: Object.fromEntries([...cases].map(([id, bytes]) => [id, decodeCase(bytes)])) }),
    ...(inputs.size === 0 ? {} : { inputs: Object.fromEntries(inputs) }),
  };
}

/**
 * One case's stored readings off its bytes, for tests that read what the
 * native lay wrote; the reader the record uses is the addon's.
 */
export function decodeCase(bytes: Uint8Array): StoredReading[] {
  const refused = (): Error => new Error('the record\'s readings section is not one this build reads');
  const invalid = (): never => {
    throw refused();
  };
  const read = varints(bytes, refused);
  const strings: string[] = [];
  for (let count = read.take(); strings.length < count;) strings.push(Buffer.from(read.bytes(read.take())).toString('utf8'));
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
  if (!read.done) invalid();
  return readings;
}

/**
 * A section as the native lay writes it, for tests that start from one; the
 * writer the record uses is the addon's.
 */
export function encodeReadings(cases: readonly (readonly [string, readonly StoredReading[]])[], inputs: readonly (readonly [string, string])[]): Buffer {
  const out: number[] = [];
  const id = fronted(out);
  put(out, cases.length);
  for (const [case_, readings] of cases) {
    id(case_);
    const own = caseBytes(readings);
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

/** One case's bytes in the section: its readings as {@link decodeCase} reads them. */
export function caseBytes(readings: readonly StoredReading[]): number[] {
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
