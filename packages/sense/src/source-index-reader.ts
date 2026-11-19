/**
 * A source-index chain as the addon reads it (`native/src/index_reader.rs`),
 * the one reader of the format.
 *
 * The chain is opened once and asked questions: a key, a count or a membership
 * crosses without a row being decoded, and a row crosses only when it is asked
 * for, as JSON shaped as {@link StoredSourceIndex} holds it. A row asked twice
 * is the same object both times, so a caller that compares by pointer — the
 * save's difference does — finds an unchanged row unchanged without a walk.
 */

// compass: variance-authority.reach.source-index

import type { Digest } from '@variance-authority/core/format';
import type { Parsed, ParseKey } from './cache.js';
import { native, nativeRefusal } from './addon.js';
import { readonlyMap } from './ordered-map.js';
import type { IndexedRecord, StoredSourceIndex } from './source-index-format.js';

/** Rows per crossing when a whole map is walked: a page of JSON, not the index. */
const PAGE = 1024;

/** What a chain read: its oldest segments that read, as one generation. */
export interface ReadSourceIndexChain {
  /** How many of the chain's oldest segments read. */
  readonly kept: number;
  /** The format version of the segment that stopped the read, when another release wrote it. */
  readonly written?: number;
  /** What the kept segments hold, newest answering first. */
  readonly stored: StoredSourceIndex;
}

/** Read the chain `segments` holds, oldest first, up to the first segment that does not read. */
export function readSourceIndexChain(segments: readonly Uint8Array[]): ReadSourceIndexChain {
  const reader = opened().openSourceIndexReader([...segments]);
  const config = reader.config() ?? undefined;
  const written = reader.written() ?? undefined;
  const flat = reader.directories();
  const directories = new Map<string, Digest>();
  for (let at = 0; at < flat.length; at += 2) directories.set(flat[at]!, flat[at + 1]! as Digest);
  return {
    kept: reader.kept(),
    ...(written === undefined ? {} : { written }),
    stored: {
      parses: lazyMap<ParseKey, Parsed>({
        count: () => reader.parseCount(),
        keys: () => reader.parseKeys() as ParseKey[],
        has: (key) => reader.hasParse(key),
        one: (key) => reader.parse(key),
        page: (start, count) => reader.parses(start, count),
        revive: (row) => row as Parsed,
      }),
      ...(config === undefined ? {} : { config: config as Digest }),
      directories,
      records: lazyMap<string, IndexedRecord>({
        count: () => reader.recordCount(),
        keys: () => reader.recordFiles(),
        has: (file) => reader.hasRecord(file),
        one: (file) => reader.record(file),
        page: (start, count) => reader.records(start, count),
        revive: record,
      }),
    },
  };
}

/** Read one segment that must read whole: one the addon just wrote. */
export function readSourceIndexSegment(bytes: Uint8Array): StoredSourceIndex {
  const read = readSourceIndexChain([bytes]);
  if (read.kept !== 1) throw new Error('not a variance-authority source index');
  return read.stored;
}

function opened(): NonNullable<ReturnType<typeof native>> {
  const addon = native();
  if (addon === undefined) {
    throw new Error(`the source index is read by the native addon, which did not load: ${nativeRefusal()}`);
  }
  return addon;
}

/** A stored target the record names no file for crosses as `null`, and is held as absent. */
function record(row: unknown): IndexedRecord {
  const held = row as { targets?: (string | null)[] };
  if (held.targets !== undefined) {
    for (let at = 0; at < held.targets.length; at += 1) {
      if (held.targets[at] === null) held.targets[at] = undefined as unknown as string;
    }
  }
  return row as IndexedRecord;
}

interface Rows<K extends string, V> {
  count(): number;
  keys(): K[];
  has(key: K): boolean;
  one(key: K): string | null;
  page(start: number, count: number): string;
  revive(row: unknown): V;
}

/** A map whose rows are decoded when asked, each once. */
function lazyMap<K extends string, V>(rows: Rows<K, V>): ReadonlyMap<K, V> {
  const decoded = new Map<K, V>();
  let size: number | undefined;
  let keys: K[] | undefined;
  const get = (key: K): V | undefined => {
    const held = decoded.get(key);
    if (held !== undefined) return held;
    const json = rows.one(key);
    if (json === null) return undefined;
    const value = rows.revive(JSON.parse(json));
    decoded.set(key, value);
    return value;
  };
  function* entries(): Generator<[K, V], undefined, unknown> {
    const total = size ??= rows.count();
    for (let start = 0; start < total; start += PAGE) {
      for (const [key, row] of JSON.parse(rows.page(start, PAGE)) as [K, unknown][]) {
        let value = decoded.get(key);
        if (value === undefined) {
          value = rows.revive(row);
          decoded.set(key, value);
        }
        yield [key, value];
      }
    }
  }
  return readonlyMap({
    size: () => size ??= rows.count(),
    get,
    has: (key) => decoded.has(key) || rows.has(key),
    entries,
    keys: () => keys ??= rows.keys(),
  });
}
