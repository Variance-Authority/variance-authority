import { NONE, openSegment, stringReader, type OpenSegment } from '@variance-authority/core/segment';
import type { UseKind } from '@variance-authority/package/help';

/**
 * The layout of the questions' store, as `help_store.rs` in the sense addon
 * writes it: a segment in the source index's framing, under its own format
 * name. Its head comes first — the generation it belongs to, as a small
 * dictionary and one id per field — so whether a published store is current is
 * read off the header and those columns without reading the rest of it.
 */

/** `FORMAT` and `VERSION` in `help_store.rs`. */
const FORMAT = 'variance-authority-help-store';
const VERSION = 7;
const WHAT = 'help store';
export { NONE };

export const USE_KINDS: readonly UseKind[] = ['source', 'test', 'story'];
export const THROUGH = [undefined, 'dynamic', 'namespace'] as const;

/** The generation a published store belongs to, read off its head. */
export interface StoreHead {
  /** The workspace root the value was read from. */
  readonly root: string;
  /** Repository root every recorded file is relative to. */
  readonly graphRoot: string;
  readonly graphDigest: string;
  readonly generatedAt: string;
  /**
   * When the read behind the value began, before any of it was read: a file
   * written before this is in the value, and one written after it may not be. A
   * refresh of listed files keeps the time of the read it refreshed, because it
   * read nothing else, so a file it listed counts as written after. `generatedAt`
   * is taken after the read, so it says neither.
   */
  readonly readStartedAt: string;
  /** The export list as a set, as `encodeHelpStore` states it. */
  readonly exportedDigest: string;
  /** Every `export … from` as a set, as `forwardsDigest` states it; a value without it is read again. */
  readonly forwardsDigest?: string;
  /** The index manifest the value was refreshed from; absent when it was read another way. */
  readonly indexDigest?: string;
  /** The package manifests the value was joined against, as `packagesDigest` states them. */
  readonly packagesDigest?: string;
}

/** The fields `head` holds, in its order. */
const HEAD_FIELDS = [
  'root', 'graphRoot', 'graphDigest', 'generatedAt', 'readStartedAt', 'exportedDigest', 'forwardsDigest', 'indexDigest', 'packagesDigest',
] as const;
export type HeadFields = Partial<Record<(typeof HEAD_FIELDS)[number], string>>;

/** The head's fields, read off its three columns alone. */
function fieldsOf(segment: OpenSegment): HeadFields {
  const ids = segment.u32('head');
  if (ids.length !== HEAD_FIELDS.length) throw segment.reject();
  const { optional } = stringReader(segment.u8('head.blob'), segment.u32('head.off'), segment.reject);
  const fields: HeadFields = {};
  HEAD_FIELDS.forEach((field, at) => {
    const value = optional(ids[at]!);
    if (value !== undefined) fields[field] = value;
  });
  return fields;
}

export function generationOf(fields: HeadFields): StoreHead | undefined {
  const { root, graphRoot, graphDigest, generatedAt, readStartedAt, exportedDigest, forwardsDigest, indexDigest, packagesDigest } = fields;
  if (
    root === undefined || graphRoot === undefined || graphDigest === undefined
    || generatedAt === undefined || readStartedAt === undefined || exportedDigest === undefined
  ) return undefined;
  return {
    root, graphRoot, graphDigest, generatedAt, readStartedAt, exportedDigest,
    ...(forwardsDigest === undefined ? {} : { forwardsDigest }),
    ...(indexDigest === undefined ? {} : { indexDigest }),
    ...(packagesDigest === undefined ? {} : { packagesDigest }),
  };
}

/**
 * The generation the store `bytes` starts with states; absent for a store
 * encoded in memory, which carries none. `bytes` may be the store's first bytes
 * alone: a read past them throws `SegmentCutShort` with the length that holds
 * the head, so a caller asking whether a store is current reads no more of it.
 */
export function storeHeadOf(bytes: Uint8Array): StoreHead | undefined {
  return generationOf(fieldsOf(openSegment(FORMAT, VERSION, bytes, WHAT, { prefix: true })));
}

/** The sections of one store, read in place, with the string pool every row refers to. */
export interface Sections {
  readonly fields: HeadFields;
  readonly bytesOf: (name: string) => Buffer;
  readonly u32: (name: string) => Uint32Array;
  /** The pooled string `id` names. */
  readonly string: (id: number) => string;
  /** The same, absent for an id that names none. */
  readonly maybe: (id: number | undefined) => string | undefined;
  /** The rows `key` owns, read off an offset column. */
  readonly slice: (off: Uint32Array, rows: Uint32Array, key: number) => Uint32Array;
}

/** The sections of one store, read in place. Throws on anything that is not this format and version. */
export function sectionsOf(bytes: Uint8Array): Sections {
  const segment = openSegment(FORMAT, VERSION, bytes, WHAT);
  const bytesOf = (name: string): Buffer => {
    const held = segment.u8(name);
    return Buffer.from(held.buffer, held.byteOffset, held.byteLength);
  };
  const { text, optional } = stringReader(segment.u8('strings.blob'), segment.u32('strings.off'), segment.reject);
  const maybe = (id: number | undefined): string | undefined => (id === undefined ? undefined : optional(id));
  const slice = (off: Uint32Array, rows: Uint32Array, key: number): Uint32Array =>
    rows.subarray(off[key] ?? 0, off[key + 1] ?? 0);
  return { fields: fieldsOf(segment), bytesOf, u32: (name) => segment.u32(name), string: text, maybe, slice };
}
