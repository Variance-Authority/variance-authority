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
import { realPath } from './resolve.js';
import { prune, type RecordCache, type TreeShape } from './reuse.js';
import {
  openSourceIndexFile,
  type EncodedParseLayer,
  type IndexedRecord,
  type SourceIndexState,
} from './source-index-file.js';
import { decodeSourceIndex } from './source-index-format.js';
import type { NativeIndexGraph } from './native-index-graph.js';

const nativeParses = new WeakMap<ParseCache, EncodedParseLayer>();

/** Attach a native parse generation to the persistent cache that will publish it. */
export function adoptNativeParses(cache: ParseCache, layer: EncodedParseLayer): void {
  nativeParses.set(cache, layer);
}

export interface PersistentSourceIndex {
  /** Whether the chain this opened was whole, absent, or readable only up to a bad segment or one of another format version. */
  readonly state: SourceIndexState;
  /** The format version the unread segment names, when `state` is `other-version`. */
  readonly written?: number;
  /** Content-keyed facts passed to `scanRelations` as `cache`. */
  readonly cache: ParseCache;
  /** Tree-keyed resolved records passed to `scanRelations` as `reuse`. */
  readonly reuse: RecordCache;
  /**
   * Atomically publish the facts this scan used. I/O failure is absorbed and
   * returned: what the file system refused, or `undefined` when the index on
   * disk holds what this scan used.
   */
  save(): Promise<string | undefined>;
}

/**
 * Where a checkout keeps its source index.
 *
 * Named here rather than chosen by each caller, because the saving is only real
 * if two callers agree: a tool that picks its own path re-scans a repository
 * another tool already scanned, and both of them report a cold start as normal.
 * The directory is the checkout's own cache layer, so a worktree writes beside
 * the primary checkout rather than into it ([`cache-layers.ts`](./test-selection/cache-layers.ts)).
 * Keyed by the root the scan itself reads from, links followed: a checkout
 * reached through `/var` and through `/private/var` is one checkout, and a
 * key spelled from the caller's argument would give it two indexes and let the
 * one nobody updated answer.
 */
export function sourceIndexPath(root: string, cacheRoot?: string): string {
  return resolve(cacheLayers(realPath(resolve(root)), cacheRoot).top, 'source-index.bin');
}

/**
 * The primary checkout's source index, when `root` is a worktree cut from it.
 *
 * A worktree's own index starts where the primary checkout's last update left
 * off, so its first update reads only what differs between the two checkouts.
 * `undefined` in the primary checkout itself, which has no other layer to start from.
 */
export function primarySourceIndexPath(root: string, cacheRoot?: string): string | undefined {
  const layers = cacheLayers(realPath(resolve(root)), cacheRoot);
  return layers.top === layers.base ? undefined : resolve(layers.base, 'source-index.bin');
}

/**
 * Open one versioned binary source-index generation from its immutable segments.
 *
 * A missing or incompatible chain behaves as an empty cache, and an incomplete
 * or corrupt one as the segments before the first bad one. Either can make this
 * scan slower and neither can change the resulting graph.
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
  let graph: NativeIndexGraph | undefined;
  // A chain read up to a bad segment, or one another release wrote, is rewritten
  // by the next save, whether or not this scan learned anything: the manifest
  // still names what could not be read.
  let dirty = file.state === 'damaged' || file.state === 'other-version';

  // The native layer is decoded the first time a key it holds is asked for, and
  // not before: a cold build that asks for none of its parses never holds them.
  const fromNative = (key: ParseKey): Parsed | undefined => {
    const layer = nativeParses.get(cache);
    if (layer === undefined || !layer.keys.has(key)) return undefined;
    decodedNative ??= decodeSourceIndex(layer.bytes).parses;
    return decodedNative.get(key);
  };

  const cache: ParseCache = {
    get(key) {
      const parsed = parses.get(key) ?? fromNative(key) ?? stored.parses.get(key);
      if (parsed !== undefined) parses.set(key, parsed);
      return parsed;
    },
    set(key, parsed) {
      const layer = nativeParses.get(cache);
      // A cold native graph already encoded this row into its parse layer. Help
      // still receives the transient object through the scan callback, but the
      // cache does not need a second JavaScript copy of every repository parse.
      if (layer?.keys.has(key) && parsed.harvested !== true) return;
      if (!isDeepStrictEqual(stored.parses.get(key), parsed)) dirty = true;
      if (parsed.harvested === true) layer?.keys.delete(key);
      parses.set(key, parsed);
    },
    keep(key) {
      const parsed = fromNative(key) ?? stored.parses.get(key);
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
      if (adopted !== undefined) {
        const next = { record, witnesses, ...(targets === undefined ? {} : { targets }) };
        const previous = records.get(record.file) ?? available.get(record.file);
        if (!isDeepStrictEqual(previous, next)) dirty = true;
        records.set(record.file, next);
      }
    },
    adopt(closure) {
      // Only a tree this cache adopted is published with its records, which is
      // the same test `set` applies to one record.
      if (adopted === undefined) return;
      graph = closure;
      dirty = true;
    },
  };

  return {
    state: file.state,
    ...(file.written === undefined ? {} : { written: file.written }),
    cache,
    reuse,
    async save() {
      const native = nativeParses.get(cache);
      if (!dirty && native === undefined &&
          (adopted === undefined || records.size === available.size)) return undefined;
      return file.save({
        parses,
        ...(adopted?.config === undefined
          ? stored.config === undefined ? {} : { config: stored.config }
          : { config: adopted.config }),
        directories: adopted?.directories ?? stored.directories,
        records: adopted === undefined ? stored.records : records,
      }, native, graph);
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
