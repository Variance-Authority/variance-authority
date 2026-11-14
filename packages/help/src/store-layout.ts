import type { UseKind } from '@variance-authority/package/help';

/**
 * The layout of the questions' store, as `help_store.rs` in the sense addon
 * writes it: a header, a head that names the generation, and the place of
 * every section. Reading the head alone answers whether a published store is
 * current without reading the rest of it.
 */

const MAGIC = 0x53484156; // "VAHS", little-endian
const VERSION = 6;
export const NONE = 0xffffffff;

export const USE_KINDS: readonly UseKind[] = ['source', 'test', 'story'];
export const THROUGH = [undefined, 'dynamic', 'namespace'] as const;

const SECTIONS = [
  'strings.off', 'strings.blob', 'files',
  'names.name', 'names.rank', 'names.lowerOff', 'names.lower', 'names.pubOff', 'names.pub', 'names.expOff', 'names.exp',
  'pub.name', 'pub.spec', 'pub.kind', 'pub.doc', 'pub.at', 'pub.usedByOff', 'pub.usedByList', 'pub.uses', 'pub.sitesOff', 'pub.tdOff',
  'pub.docLowerOff', 'pub.docLower',
  'pub.declared', 'pub.line', 'pub.signature', 'pub.mentionAt', 'pub.mentionLine', 'pub.mentionText',
  'exp.name', 'exp.at', 'exp.by', 'exp.line', 'exp.kind', 'exp.doc', 'exp.docLowerOff', 'exp.docLower',
  'exp.type', 'exp.bound', 'exp.declaration', 'exp.boundLine', 'exp.signature',
  'use.by', 'use.at', 'use.line', 'use.flags', 'use.throughLine', 'use.local', 'use.name',
  'pkg.name', 'pkg.entry', 'pkg.openOff',
  'open.subpath', 'open.source', 'open.entryOff', 'open.wholeOff',
  'deep.specifier', 'deep.by', 'deep.at', 'deep.line', 'deep.to', 'deep.namesOff', 'deep.groups',
  'unreadable',
  'terms.off', 'terms.blob', 'terms.nameOff', 'terms.name', 'terms.pubOff', 'terms.pub', 'terms.expOff', 'terms.exp',
  'terms.pubSigOff', 'terms.pubSig', 'terms.expSigOff', 'terms.expSig',
] as const;
export type SectionName = (typeof SECTIONS)[number];

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

const HEAD_FIELDS = [
  'root', 'graphRoot', 'graphDigest', 'generatedAt', 'readStartedAt', 'exportedDigest', 'forwardsDigest', 'indexDigest', 'packagesDigest',
] as const;
export type HeadFields = Partial<Record<(typeof HEAD_FIELDS)[number], string>>;

function align(at: number): number {
  return (at + 3) & ~3;
}

function bufferOf(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * How many bytes the header and head `bytes` starts with take, read off its
 * first 12. Throws on anything that is not this format and version.
 */
export function storeHeadLength(bytes: Uint8Array): number {
  const view = bufferOf(bytes);
  if (view.length < 12 || view.readUInt32LE(0) !== MAGIC || view.readUInt32LE(4) !== VERSION) {
    throw new Error(`not a help store v${String(VERSION)}`);
  }
  return 12 + view.readUInt32LE(8);
}

/** The head's fields and the place of every section, read off a buffer that holds at least the head. */
function headOf(bytes: Buffer): { readonly fields: HeadFields; readonly sections: readonly (readonly [number, number])[] } {
  const end = storeHeadLength(bytes);
  const short = (): never => {
    throw new Error("the help store's head is cut short");
  };
  if (bytes.length < end) short();
  let at = 12;
  const word = (): number => {
    if (at + 4 > end) short();
    const value = bytes.readUInt32LE(at);
    at += 4;
    return value;
  };
  const fields: HeadFields = {};
  for (const field of HEAD_FIELDS) {
    const size = word();
    if (size === NONE) continue;
    if (at + size > end) short();
    fields[field] = bytes.toString('utf8', at, at + size);
    at += size;
  }
  const count = word();
  if (count !== SECTIONS.length) {
    throw new Error(`the help store holds ${String(count)} sections, not ${String(SECTIONS.length)}`);
  }
  const sections: (readonly [number, number])[] = [];
  for (let section = 0; section < count; section += 1) sections.push([word(), word()]);
  return { fields, sections };
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
 * The generation the head `bytes` starts with states; absent for a store
 * encoded in memory, which carries none. `bytes` need hold only the head, so a
 * caller asking whether a store is current reads no more of it.
 */
export function storeHeadOf(bytes: Uint8Array): StoreHead | undefined {
  return generationOf(headOf(bufferOf(bytes)).fields);
}

/** The digest of the export list the head `bytes` starts with states. */
export function storeExportedDigest(bytes: Uint8Array): string | undefined {
  return headOf(bufferOf(bytes)).fields.exportedDigest;
}

/** The sections of one store, read in place, with the string pool every row refers to. */
export interface Sections {
  readonly fields: HeadFields;
  readonly bytesOf: (name: SectionName) => Buffer;
  readonly u32: (name: SectionName) => Uint32Array;
  /** The pooled string `id` names. */
  readonly string: (id: number) => string;
  /** The same, absent for an id that names none. */
  readonly maybe: (id: number | undefined) => string | undefined;
  /** The rows `key` owns, read off an offset column. */
  readonly slice: (off: Uint32Array, rows: Uint32Array, key: number) => Uint32Array;
}

/** The sections of one store, read in place. Throws on anything that is not this format and version. */
export function sectionsOf(bytes: Uint8Array): Sections {
  // Columns are read in place as 32-bit words, which needs them 4-aligned.
  const buffer = bytes.byteOffset % 4 === 0 ? bufferOf(bytes) : Buffer.from(new Uint8Array(bytes).buffer);
  const { fields, sections } = headOf(buffer);
  const start = align(storeHeadLength(buffer));
  const index = new Map<string, number>(SECTIONS.map((name, at) => [name, at]));
  const bytesOf = (name: SectionName): Buffer => {
    const [at, length] = sections[index.get(name) ?? -1] ?? [0, 0];
    if (start + at + length > buffer.length) throw new Error(`the help store's ${name} is cut short`);
    return buffer.subarray(start + at, start + at + length);
  };
  const u32 = (name: SectionName): Uint32Array => {
    const held = bytesOf(name);
    return new Uint32Array(held.buffer, held.byteOffset, held.byteLength / 4);
  };
  const stringOff = u32('strings.off');
  const stringBlob = bytesOf('strings.blob');
  const string = (id: number): string => stringBlob.toString('utf8', stringOff[id] ?? 0, stringOff[id + 1] ?? 0);
  const maybe = (id: number | undefined): string | undefined => (id === undefined || id === NONE ? undefined : string(id));
  const slice = (off: Uint32Array, rows: Uint32Array, key: number): Uint32Array =>
    rows.subarray(off[key] ?? 0, off[key + 1] ?? 0);
  return { fields, bytesOf, u32, string, maybe, slice };
}
