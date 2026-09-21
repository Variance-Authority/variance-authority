/**
 * One durable generation for everything the source scan can reuse.
 *
 * Parses and resolved records share each segment's dictionary because paths,
 * specifiers, names and digests are repeated across both. Keeping them behind
 * one save also prevents a run from publishing parse and record states that
 * never existed together.
 */

import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { FileRecord } from '@variance-authority/core/relate';
import type { ParseCache, ParseKey, Parsed } from './cache.js';
import { cacheLayers } from './test-selection/cache-layers.js';
import { prune, type RecordCache, type TreeShape } from './reuse.js';
import {
  openSourceIndexFile,
  type EncodedParseLayer,
  type IndexedRecord,
} from './source-index-file.js';
import { decodeSourceIndex } from './source-index-format.js';

const nativeParses = new WeakMap<ParseCache, EncodedParseLayer>();

/** Attach a native parse generation to the persistent cache that will publish it. */
export function adoptNativeParses(cache: ParseCache, layer: EncodedParseLayer): void {
  nativeParses.set(cache, layer);
}

export interface PersistentSourceIndex {
  /** Content-keyed facts passed to `scanRelations` as `cache`. */
  readonly cache: ParseCache;
  /** Tree-keyed resolved records passed to `scanRelations` as `reuse`. */
  readonly reuse: RecordCache;
  /** Atomically publish the facts this scan used; I/O failure is absorbed. */
  save(): Promise<void>;
}

/**
 * Where a checkout keeps its source index.
 *
 * Named here rather than chosen by each caller, because the saving is only real
 * if two callers agree: a tool that picks its own path re-scans a repository
 * another tool already scanned, and both of them report a cold start as normal.
 * The directory is the checkout's own cache layer, so a worktree writes beside
 * the primary checkout rather than into it ([`cache-layers.ts`](./test-selection/cache-layers.ts)).
 */
export function sourceIndexPath(root: string, cacheRoot?: string): string {
  return resolve(cacheLayers(root, cacheRoot).top, 'source-index.bin');
}

/**
 * Open one versioned binary source-index generation from its immutable segments.
 *
 * A missing, incompatible, incomplete, or corrupt chain behaves as an empty
 * cache. It can make this scan slower and cannot change the resulting graph.
 */
export async function openSourceIndex(path: string): Promise<PersistentSourceIndex> {
  const file = await openSourceIndexFile(path);
  const stored = file.stored;
  const available = new Map(stored.records);
  const held: TreeShape | undefined = stored.config === undefined
    ? undefined
    : { config: stored.config, directories: stored.directories };
  const parses = new Map<ParseKey, Parsed>();
  let decodedNative: ReadonlyMap<ParseKey, Parsed> | undefined;
  const records = new Map<string, IndexedRecord>();
  let adopted: TreeShape | undefined;
  let dirty = false;

  const cache: ParseCache = {
    get(key) {
      const layer = nativeParses.get(cache);
      if (decodedNative === undefined && layer !== undefined) {
        decodedNative = decodeSourceIndex(layer.bytes).parses;
      }
      const parsed = parses.get(key) ?? decodedNative?.get(key) ?? stored.parses.get(key);
      if (parsed !== undefined) parses.set(key, parsed);
      return parsed;
    },
    set(key, parsed) {
      if (!isDeepStrictEqual(stored.parses.get(key), parsed)) dirty = true;
      const layer = nativeParses.get(cache);
      if (parsed.harvested === true) layer?.keys.delete(key);
      parses.set(key, parsed);
    },
    keep(key) {
      const layer = nativeParses.get(cache);
      if (decodedNative === undefined && layer !== undefined) {
        decodedNative = decodeSourceIndex(layer.bytes).parses;
      }
      const parsed = decodedNative?.get(key) ?? stored.parses.get(key);
      if (parsed !== undefined) parses.set(key, parsed);
    },
  };

  const reuse: RecordCache = {
    under(shape) {
      adopted = shape;
      if (prune(available, held, shape)) dirty = true;
      records.clear();
    },
    get(file, digest) {
      if (adopted === undefined) return undefined;
      const found = records.get(file) ?? available.get(file);
      if (found?.record.digest !== digest) return undefined;
      records.set(file, found);
      return found.record;
    },
    getIndexed(file, digest) {
      if (adopted === undefined) return undefined;
      const found = records.get(file) ?? available.get(file);
      if (found?.record.digest !== digest) return undefined;
      records.set(file, found);
      return found;
    },
    set(record, witnesses, targets) {
      if (adopted !== undefined && record.digest !== undefined) {
        const next = { record, witnesses, ...(targets === undefined ? {} : { targets }) };
        const previous = records.get(record.file) ?? available.get(record.file);
        if (!isDeepStrictEqual(previous, next)) dirty = true;
        records.set(record.file, next);
      }
    },
  };

  return {
    cache,
    reuse,
    async save() {
      const native = nativeParses.get(cache);
      if (!dirty && native === undefined &&
          (adopted === undefined || records.size === available.size)) return;
      await file.save({
        parses,
        ...(adopted?.config === undefined
          ? stored.config === undefined ? {} : { config: stored.config }
          : { config: adopted.config }),
        directories: adopted?.directories ?? stored.directories,
        records: adopted === undefined ? stored.records : records,
      }, native);
    },
  };
}

/**
 * Read the resolved records of the committed generation without inspecting the
 * checkout or asking Git whether it changed.
 */
export async function readSourceRecords(path: string): Promise<readonly FileRecord[]> {
  const stored = (await openSourceIndexFile(path)).stored;
  return [...stored.records.values()]
    .map((held) => held.record)
    .sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
}
