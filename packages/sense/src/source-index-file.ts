import { isDeepStrictEqual } from 'node:util';
import type { Digest } from '@variance-authority/core/format';
import type { Parsed, ParseKey } from './cache.js';
import {
  BadLogPath,
  emptyImmutableLog,
  openImmutableLog,
  type ImmutableLog,
} from './immutable-log.js';
import { differenceLayer, orderedMap, type MapLayer } from './ordered-map.js';
import {
  decodeSourceIndex,
  encodeSourceIndex,
  type IndexedRecord,
  type StoredSourceIndex,
} from './source-index-format.js';

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
  /** Append what `next` changes about it; cache I/O never fails a scan. */
  save(next: StoredSourceIndex, encodedParses?: EncodedParseLayer): Promise<void>;
}

/** A parse layer already encoded by the native cold scanner. */
export interface EncodedParseLayer {
  readonly bytes: Uint8Array;
  readonly keys: Set<ParseKey>;
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
    async save(next, encodedParses) {
      await append(await baseline(path, opened), next, encodedParses);
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
): Promise<void> {
  const parses = differenceLayer(current.stored.parses, stored.parses, unchanged);
  const records = differenceLayer(current.stored.records, stored.records, unchanged);
  const directories = differenceLayer(current.stored.directories, stored.directories);
  const native = !current.log.committed && encodedParses !== undefined
    ? encodedParses
    : undefined;
  // A chain read up to a bad segment still names it, so the save that finds
  // nothing to add still rewrites the manifest without it.
  if (
    current.log.committed &&
    current.log.dropped === 0 &&
    current.stored.config === stored.config &&
    empty(parses) && empty(records) && empty(directories)
  ) return;

  const parseLayer = native === undefined
    ? parses
    : {
        puts: new Map([...parses.puts].filter(([key]) => !native.keys.has(key))),
        deletes: parses.deletes,
      };
  const delta = encodeSourceIndex(segment(stored.config, parseLayer, records, directories));

  // Persistence is a saving, never a new failure mode for the scan: a cache
  // that cannot be written costs the next run a full scan, which is what a run
  // without one pays anyway.
  //
  // The guard is around the write and not around the arithmetic above it. A
  // delta this file computed wrongly is a defect, and swallowed here it would
  // be indistinguishable from a full disk — the cache would simply never warm,
  // which is the hardest failure in this file to notice. The compaction
  // callback is the one piece of encoding left inside, because the log decides
  // whether to call it.
  try {
    if (native === undefined) {
      await current.log.publish(delta, () => encodeSourceIndex(stored));
    } else {
      await current.log.publishAll([native.bytes, delta], () => encodeSourceIndex(stored));
    }
  } catch {
    // Not written. The next scan is cold and this run's graph is unchanged.
  }
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
