/**
 * `@variance-authority/core/segment` — a column of facts, as bytes.
 *
 * Two things in this repository already had to be written down and read back on
 * another machine: the source index a scan reuses, and now the suite index a run
 * leaves behind. Both are the same shape underneath — a pile of repeated strings
 * and a pile of small integers — and both were going to grow the same four
 * hundred lines of offset arithmetic independently.
 *
 * So the arithmetic is here and the schemas are not. This module knows about
 * named sections, alignment, interned strings and the validation that a decode
 * must perform before it believes a file. It knows nothing about what any
 * section means, which is the property that lets one format change without
 * touching the other.
 *
 * ## Why columns
 *
 * The reader that matters next is not this one. Every field is a run of
 * fixed-width little-endian values at a computable offset, so a reader in
 * another language takes a slice where this one takes a loop — the same bargain
 * [`record-format.ts`](../../../sense/src/test-selection/record-format.ts)
 * already made for the coverage segments.
 *
 * ## Why the header is JSON
 *
 * It is the one part that is read before anything is known, it is a few hundred
 * bytes against a payload measured in megabytes, and being self-describing is
 * what lets a decoder reject a file by name instead of by crash. The payload —
 * the part that repeats — never is.
 *
 * ## The one rule
 *
 * A malformed reference rejects the whole file. There is no partial read and no
 * salvage: a segment is a cache or a baseline, both of which may be rebuilt, and
 * half of either is worse than neither.
 */

const ALIGNMENT = 8;

// Declared rather than imported. This package takes no platform's types — it is
// the layer every other one is allowed to run wherever it likes — and these two
// are the standard text codecs that every runtime it targets already has. A
// `Buffer` would have been shorter and would have made `core` a Node package.
declare const TextEncoder: { new (): { encode(input: string): Uint8Array } };
declare const TextDecoder: { new (): { decode(input: Uint8Array): string } };

const utf8 = { encode: new TextEncoder(), decode: new TextDecoder() };

/** The sentinel a `u32` column uses for "no value here". */
export const NONE = 0xffff_ffff;

interface Section {
  readonly name: string;
  readonly offset: number;
  readonly length: number;
  readonly width: 1 | 4;
}

interface Header {
  readonly format: string;
  readonly version: number;
  readonly sections: readonly Section[];
}

/** A column, by the width its element type already declares. */
export type Column = Uint8Array | Uint32Array;

/**
 * Write named columns as one aligned segment.
 *
 * Width is taken from the array's own type rather than from a convention about
 * the section's name, so a column that is read back as `u8` is one that was
 * written as `Uint8Array` and a mismatch is a compile error rather than a
 * decode that succeeds against the wrong stride.
 */
export function encodeSegment(
  format: string,
  version: number,
  columns: Readonly<Record<string, Column>>,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  const sections: Section[] = [];
  let offset = 0;

  for (const [name, column] of Object.entries(columns)) {
    const value = new Uint8Array(column.buffer, column.byteOffset, column.byteLength);
    sections.push({
      name,
      offset,
      length: value.length,
      width: column instanceof Uint8Array ? 1 : 4,
    });
    chunks.push(value);
    offset += value.length;
    const padding = aligned(offset) - offset;
    if (padding > 0) chunks.push(new Uint8Array(padding));
    offset += padding;
  }

  const header: Header = { format, version, sections };
  const encoded = utf8.encode.encode(JSON.stringify(header));
  // The header is padded rather than merely written, so every section offset it
  // names is an aligned offset into the file and not only into the payload.
  const headerLength = aligned(4 + encoded.length) - 4;
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, headerLength, true);
  return concat([prefix, encoded, new Uint8Array(headerLength - encoded.length), ...chunks]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Columns of one opened segment, by name. Every accessor may reject the file. */
export interface OpenSegment {
  /** A `u8` column. Absent or of the wrong width rejects the file. */
  u8(name: string): Uint8Array;
  /** A `u32` column. Absent or of the wrong width rejects the file. */
  u32(name: string): Uint32Array;
  /** A `u32` column a writer of this version may legitimately not have written. */
  maybeU32(name: string): Uint32Array;
  /** Refuse the file, in the words the caller's format uses. */
  reject(): Error;
}

/**
 * Open a segment, refusing anything that is not one of the named format and
 * version.
 *
 * `what` is the noun a rejection is phrased with — "source index", "suite index"
 * — because the one thing a caller of this can usefully be told is which reader
 * refused, and a shared message would name none of them.
 */
export function openSegment(
  format: string,
  version: number,
  input: Uint8Array,
  what: string,
): OpenSegment {
  const reject = (): Error => new Error(`not a variance-authority ${what}`);
  // Copied when it does not start on an alignment boundary, because the whole
  // point of the padding is that a `u32` column can be a view rather than a
  // parse, and a view is only legal at a multiple of its own width. A read that
  // lands mid-pool — which is what a small file off a disk usually is — pays one
  // copy for that guarantee instead of losing it.
  const raw = input.byteOffset % ALIGNMENT === 0 ? input : input.slice();
  if (raw.length < 4) throw reject();
  const headerLength = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0, true);
  if (headerLength > raw.length - 4) throw reject();

  let header: Header;
  try {
    const text = utf8.decode.decode(raw.subarray(4, 4 + headerLength));
    header = JSON.parse(text.replace(/\0+$/, '')) as Header;
  } catch {
    throw reject();
  }
  if (
    header.format !== format ||
    header.version !== version ||
    !validSections(header.sections, raw.length - 4 - headerLength)
  ) throw reject();

  const base = 4 + headerLength;
  const found = new Map(header.sections.map((section) => [section.name, section]));
  const at = (name: string, width: 1 | 4): Section => {
    const section = found.get(name);
    if (section === undefined || section.width !== width) throw reject();
    return section;
  };

  return {
    reject,
    u8(name) {
      const section = at(name, 1);
      return new Uint8Array(raw.buffer, raw.byteOffset + base + section.offset, section.length);
    },
    u32(name) {
      const section = at(name, 4);
      if (section.length % 4 !== 0) throw reject();
      return new Uint32Array(
        raw.buffer,
        raw.byteOffset + base + section.offset,
        section.length / 4,
      );
    },
    maybeU32(name) {
      const section = found.get(name);
      if (section === undefined) return new Uint32Array();
      if (section.width !== 4 || section.length % 4 !== 0) throw reject();
      return new Uint32Array(
        raw.buffer,
        raw.byteOffset + base + section.offset,
        section.length / 4,
      );
    },
  };
}

/**
 * Every distinct string, sorted, and the number each one is written as.
 *
 * Sorted rather than first-seen because two encodes of equal facts must produce
 * equal bytes: a segment is content-addressed by whoever caches it, and an
 * identical index that hashes differently defeats every transport that would
 * otherwise have skipped the upload.
 */
export function intern(values: Iterable<string>): {
  readonly strings: readonly string[];
  readonly id: (value: string) => number;
  /** `NONE` for `undefined`, so an absent field costs a column and not a branch. */
  readonly optionalId: (value: string | undefined) => number;
} {
  const strings = [...new Set(values)].sort(codeUnitOrder);
  const ids = new Map(strings.map((value, index) => [value, index]));
  const id = (value: string): number => {
    const found = ids.get(value);
    if (found === undefined) throw new Error(`string not interned: ${JSON.stringify(value)}`);
    return found;
  };
  return { strings, id, optionalId: (value) => (value === undefined ? NONE : id(value)) };
}

/** The two columns a dictionary is written as: the bytes, and where each one ends. */
export function stringColumns(strings: readonly string[]): {
  readonly blob: Uint8Array;
  readonly off: Uint32Array;
} {
  const encoded = strings.map((value) => utf8.encode.encode(value));
  return { blob: concat(encoded), off: offsetsOf(encoded.map((value) => value.length)) };
}

/** Read strings back out of a dictionary, rejecting any id the blob cannot hold. */
export function stringReader(
  blob: Uint8Array,
  off: Uint32Array,
  reject: () => Error,
): { readonly text: (id: number) => string; readonly optional: (id: number) => string | undefined } {
  validateOffsets(off, blob.length, off.length - 1, reject);
  const text = (id: number): string => {
    const start = off[id];
    const end = off[id + 1];
    if (start === undefined || end === undefined) throw reject();
    return utf8.decode.decode(blob.subarray(start, end));
  };
  return { text, optional: (id) => (id === NONE ? undefined : text(id)) };
}

/** A running-total column: `result[n]` is where row `n` starts, `result.at(-1)` the end. */
export function offsetsOf(lengths: readonly number[]): Uint32Array {
  const result = new Uint32Array(lengths.length + 1);
  for (let index = 0; index < lengths.length; index += 1) {
    result[index + 1] = result[index]! + lengths[index]!;
  }
  return result;
}

/**
 * Check an offset column before any row is read through it.
 *
 * Checked here rather than per row because an offset column is the one thing in
 * a segment that can turn a corrupt file into a *plausible* value: a pair that
 * runs backwards reads a neighbouring row's data as this row's, and nothing
 * downstream would ever notice.
 */
export function validateOffsets(
  column: Uint32Array,
  end: number,
  rows: number,
  reject: () => Error,
): void {
  if (column.length !== rows + 1 || column[0] !== 0 || column[column.length - 1] !== end) {
    throw reject();
  }
  for (let index = 1; index < column.length; index += 1) {
    if (column[index]! < column[index - 1]!) throw reject();
  }
}

/** Columns that describe the same rows must agree about how many there are. */
export function sameLength(
  length: number,
  columns: readonly { readonly length: number }[],
  reject: () => Error,
): void {
  if (columns.some((column) => column.length !== length)) throw reject();
}

/** The indices row `row` owns in the column an offset column points into. */
export function rangeOf(offsets: Uint32Array, row: number, reject: () => Error): number[] {
  const start = offsets[row];
  const end = offsets[row + 1];
  if (start === undefined || end === undefined) throw reject();
  return Array.from({ length: end - start }, (_, index) => start + index);
}

/** A stored boolean, refusing the file for anything that is not one. */
export function flagOf(value: number | undefined, reject: () => Error): boolean {
  if (value !== 0 && value !== 1) throw reject();
  return value === 1;
}

function validSections(sections: readonly Section[], available: number): boolean {
  if (!Array.isArray(sections) || sections.length === 0) return false;
  if (new Set(sections.map((section) => section.name)).size !== sections.length) return false;
  const ordered = [...sections].sort((left, right) => left.offset - right.offset);
  let end = 0;
  for (const section of ordered) {
    if (
      typeof section.name !== 'string' ||
      !Number.isSafeInteger(section.offset) ||
      !Number.isSafeInteger(section.length) ||
      section.offset < end ||
      section.offset % ALIGNMENT !== 0 ||
      section.length < 0 ||
      section.length > available - section.offset ||
      (section.width !== 1 && section.width !== 4)
    ) return false;
    end = section.offset + section.length;
  }
  return ordered[0]?.offset === 0;
}

function aligned(value: number): number {
  return Math.ceil(value / ALIGNMENT) * ALIGNMENT;
}

/**
 * Order two strings by UTF-16 code unit, which is the order a segment is sorted in.
 *
 * Exported because a schema that sorts its own values before interning them has
 * to sort them the same way this does, and `localeCompare` is the trap: it is
 * locale-dependent, so an index written on one machine would interleave
 * differently on another and two encodes of equal facts would stop producing
 * equal bytes.
 */
export function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
