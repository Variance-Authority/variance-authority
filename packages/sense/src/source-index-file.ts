import { isDeepStrictEqual } from 'node:util';
import type { Digest } from '@variance-authority/core/format';
import type { Parsed, ParseKey } from './cache.js';
import { native as addon, nativeRefusal } from './addon.js';
import { BadLogPath, emptyImmutableLog, openImmutableLog, type ImmutableLog } from './immutable-log.js';
import { differenceLayer, orderedMap, type MapLayer } from './ordered-map.js';
import {
  decodeSourceIndex,
  encodeSourceIndex,
  sourceIndexDocuments,
  type IndexedRecord,
  type StoredSourceIndex,
} from './source-index-format.js';
import type { NativeIndexGraph } from './native-index-graph.js';
import type { NativeScanner } from './native.js';

export type { IndexedRecord, StoredSourceIndex } from './source-index-format.js';

const EMPTY: StoredSourceIndex = { parses: new Map(), records: new Map(), directories: new Map() };

/**
 * What opening a chain found: a whole one, none, or one that could only be read
 * up to a segment that was missing, corrupt or foreign.
 */
export type SourceIndexState = 'published' | 'missing' | 'damaged';

/** One opened generation and the writer that appends to the chain it came from. */
export interface SourceIndexFile {
  /** The committed generation, or the valid prefix of it when `state` is `damaged`. */
  readonly stored: StoredSourceIndex;
  readonly state: SourceIndexState;
  /** The committed chain's segment digests that were read: the generation's identity. */
  readonly generation: readonly Digest[];
  /**
   * Append what `next` changes about it; cache I/O never fails a scan. What the
   * file system refused, when it did, so a caller whose job is the write can
   * say so; `undefined` when the chain holds `next`.
   */
  save(
    next: StoredSourceIndex,
    encodedParses?: EncodedParseLayer,
    graph?: NativeIndexGraph,
  ): Promise<string | undefined>;
}

/**
 * A parse layer already encoded by the native cold scanner, and the keys it
 * still answers for: a parse JavaScript harvested since is deleted from them,
 * and written with the rest of JavaScript's parses.
 */
export interface EncodedParseLayer {
  readonly bytes: Uint8Array;
  readonly keys: { has(key: ParseKey): boolean; delete(key: ParseKey): unknown };
}

interface Opened {
  readonly stored: StoredSourceIndex;
  readonly log: ImmutableLog;
  readonly state: SourceIndexState;
}

/** A missing, foreign, incomplete, or corrupt chain is an empty cache. */
export async function readSourceIndex(path: string): Promise<StoredSourceIndex> {
  return (await openSourceIndexFile(path)).stored;
}

/**
 * Open the generation at `path` once, and keep it as the baseline for the save.
 *
 * A save has to know what is committed in order to write only the difference,
 * and the answer is the chain this call already read. Asking the file system for
 * it a second time buys one thing — a segment another writer published in the
 * meantime — and it is the manifest that carries that, not the segment bytes. So
 * the save re-reads the manifest, which is one small file, and decodes again only
 * on the run where the chain actually moved underneath it.
 */
export async function openSourceIndexFile(path: string): Promise<SourceIndexFile> {
  const opened = await opening(path);
  return {
    stored: opened.stored,
    state: opened.state,
    generation: opened.log.digests,
    async save(next, encodedParses, graph) {
      const current = await baseline(path, opened);
      const cold = graph === undefined ? false : await published(path, current, next, encodedParses, graph);
      if (cold !== false) return cold ?? undefined;
      return append(current, next, encodedParses, graph);
    },
  };
}

/**
 * Everything a read can fail at is a cache miss, except being asked wrongly.
 *
 * A chain that is missing, foreign, truncated or corrupt costs the segments
 * from the first unusable one onward — the whole of it when that is the
 * manifest — which a scan pays back by re-reading what they held, so it is
 * answered with the valid prefix and a `state` that says so. A caller that passed something that cannot name a
 * file is not in that class: swallowed here it would return an empty cache and
 * then hand the same unusable path to the writer, so the run would report a
 * warm-cache saving of nothing, every run, and write its segments under a name
 * nobody chose. That one throws.
 */
function miss(error: unknown): never | void {
  if (error instanceof BadLogPath) throw error;
}

async function opening(path: string): Promise<Opened> {
  try {
    return await load(await openImmutableLog(path));
  } catch (error) {
    miss(error);
    return { stored: EMPTY, log: emptyImmutableLog(path), state: 'damaged' };
  }
}

async function baseline(path: string, opened: Opened): Promise<Opened> {
  try {
    const committed = await openImmutableLog(path);
    // A legacy one-segment file has no manifest to compare, and this publish is
    // the thing that gives it one.
    return !committed.legacy && !opened.log.legacy && same(committed.digests, opened.log.digests)
      ? { stored: opened.stored, log: committed, state: opened.state }
      : await load(committed);
  } catch (error) {
    miss(error);
    return { stored: EMPTY, log: emptyImmutableLog(path), state: 'damaged' };
  }
}

async function append(
  current: Opened,
  stored: StoredSourceIndex,
  encodedParses?: EncodedParseLayer,
  graph?: NativeIndexGraph,
): Promise<string | undefined> {
  const parses = differenceLayer(current.stored.parses, stored.parses, unchanged);
  const records = differenceLayer(current.stored.records, stored.records, unchanged);
  const directories = differenceLayer(current.stored.directories, stored.directories);
  const native = encodedParses;
  // A chain read up to a bad segment still names it, so the save that finds
  // nothing to add still rewrites the manifest without it. A native layer is
  // never nothing: its parses are not in `stored`, so no difference sees them.
  if (
    native === undefined &&
    current.log.committed &&
    current.log.dropped === 0 &&
    current.stored.config === stored.config &&
    empty(parses) && empty(records) && empty(directories)
  ) return undefined;

  // The native layer is published ahead of the delta, onto whatever chain is
  // there. Its keys are not in `stored`, so the difference deletes every one the
  // chain already held; the delta is the later layer and would hide them.
  const ours = (key: ParseKey): boolean => native === undefined || !native.keys.has(key);
  const parseLayer = native === undefined
    ? parses
    : {
        puts: new Map([...parses.puts].filter(([key]) => ours(key))),
        deletes: new Set([...parses.deletes].filter(ours)),
      };
  // A closure the addon holds is not in `stored` either, and its records are
  // encoded into the delta on its side, winning where both name a file — as
  // they did when the scan accepted each one. The difference deleted every one
  // the chain already held, and the encoder drops those deletes.
  const written = segment(stored.config, parseLayer, records, directories);
  const delta = graph === undefined ? encodeSourceIndex(written) : graph.encode(sourceIndexDocuments(written));

  // The addon decides what the chain names next and writes it
  // (`native/src/append_index.rs`): the layers become the working layer over
  // the base the chain was readied with, and nothing is compacted here.
  //
  // Persistence is a saving, never a new failure mode for the scan: a cache
  // that cannot be written costs the next run a full scan, which is what a run
  // without one pays anyway. So a refusal is answered, not thrown — and only a
  // refusal: a delta this file computed wrongly, or an encode that failed, is
  // a defect and throws before this.
  return appended(current.log, native === undefined ? [delta] : [native.bytes, delta]) ?? undefined;
}

function appended(log: ImmutableLog, layers: readonly Uint8Array[]): string | null {
  return writer().appendSourceIndex(log.path, [...log.digests], log.legacy && log.segments.length > 0, [...layers]);
}

/**
 * Start the index at `path` as a copy of the one at `from`, when `path` has
 * none: a worktree's first update then pays only for what differs between the
 * two checkouts. The addon copies it (`native/src/append_index.rs`), checking
 * each segment against its digest; anything that stops the copy leaves `path`
 * as it was and answers `false`.
 */
export function seedSourceIndex(path: string, from: string): boolean {
  return addon()?.seedSourceIndex(path, from) ?? false;
}

function writer(): NativeScanner {
  const loaded = addon();
  if (loaded === undefined) {
    throw new Error(`the source index is written by the native addon, which did not load: ${nativeRefusal()}`);
  }
  return loaded;
}

/**
 * Publish a cold build from the addon that holds its closure, when the chain
 * is empty: the parse layer, then one generation holding the closure's records
 * and everything JavaScript read beside it. `false` when this is not the
 * save's path; otherwise what the file system refused, or `null` when written —
 * a refusal is the cache not written, as in `append`.
 *
 * Only the empty chain. A save onto a committed one has `append` hand the
 * delta to the addon, and the closure encodes it.
 */
async function published(
  path: string,
  current: Opened,
  next: StoredSourceIndex,
  encodedParses: EncodedParseLayer | undefined,
  graph: NativeIndexGraph,
): Promise<string | null | false> {
  if (current.log.committed || current.log.legacy || current.log.digests.length > 0) return false;
  if (encodedParses === undefined) return false;
  const parses = differenceLayer(current.stored.parses, next.parses, unchanged);
  const records = differenceLayer(current.stored.records, next.records, unchanged);
  const directories = differenceLayer(current.stored.directories, next.directories);
  // Nothing precedes the generation, so there is nothing for it to delete. A
  // deletion here is a baseline this function does not describe.
  if (parses.deletes.size + records.deletes.size + directories.deletes.size > 0) return false;
  return graph.publish(path, sourceIndexDocuments({
    ...(next.config === undefined ? {} : { config: next.config }),
    directories: directories.puts,
    records: records.puts,
    parses: new Map([...parses.puts].filter(([key]) => !encodedParses.keys.has(key))),
  }));
}

/**
 * A row a scan reused is the row it was handed, so most of this map answers on a
 * pointer. The structural walk is for the rest: a row rebuilt from bytes that
 * happen to say the same thing is the same row, and writing it again would grow
 * the chain by a segment that changes nothing.
 */
function unchanged<V>(before: V, after: V): boolean {
  return before === after || isDeepStrictEqual(before, after);
}

function same(left: readonly Digest[], right: readonly Digest[]): boolean {
  return left.length === right.length && left.every((digest, at) => digest === right[at]);
}

async function load(read: ImmutableLog): Promise<Opened> {
  const decoded: StoredSourceIndex[] = [];
  for (const bytes of read.segments) {
    try {
      decoded.push(decodeSourceIndex(bytes));
    } catch {
      break;
    }
  }
  const log = read.keep(decoded.length);
  const parseLayers: MapLayer<ParseKey, Parsed>[] = decoded.map((part) => ({
    puts: part.parses,
    deletes: part.deletedParses ?? new Set(),
  }));
  const recordLayers: MapLayer<string, IndexedRecord>[] = decoded.map((part) => ({
    puts: part.records,
    deletes: part.deletedRecords ?? new Set(),
  }));
  const directoryLayers: MapLayer<string, Digest>[] = decoded.map((part) => ({
    puts: part.directories,
    deletes: part.deletedDirectories ?? new Set(),
  }));
  const config = decoded.at(-1)?.config;
  return {
    log,
    state: !log.committed ? 'missing' : log.dropped > 0 ? 'damaged' : 'published',
    stored: {
      parses: orderedMap(parseLayers),
      ...(config === undefined ? {} : { config }),
      directories: orderedMap(directoryLayers),
      records: orderedMap(recordLayers),
    },
  };
}

function segment(
  config: Digest | undefined,
  parses: MapLayer<ParseKey, Parsed>,
  records: MapLayer<string, IndexedRecord>,
  directories: MapLayer<string, Digest>,
): StoredSourceIndex {
  return {
    parses: parses.puts,
    ...(parses.deletes.size === 0 ? {} : { deletedParses: parses.deletes }),
    ...(config === undefined ? {} : { config }),
    directories: directories.puts,
    ...(directories.deletes.size === 0 ? {} : { deletedDirectories: directories.deletes }),
    records: records.puts,
    ...(records.deletes.size === 0 ? {} : { deletedRecords: records.deletes }),
  };
}

function empty<K, V>(layer: MapLayer<K, V>): boolean {
  return layer.puts.size === 0 && layer.deletes.size === 0;
}
