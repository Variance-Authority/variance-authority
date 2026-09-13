/**
 * One durable generation for everything the source scan can reuse.
 *
 * Parses and resolved records share each segment's dictionary because paths,
 * specifiers, names and digests are repeated across both. Keeping them behind
 * one save also prevents a run from publishing parse and record states that
 * never existed together.
 */

import type { Digest } from '@variance-authority/core/format';
import type { ParseCache, Parsed } from './cache.js';
import { prune, type RecordCache, type TreeShape } from './reuse.js';
import { readSourceIndex, writeSourceIndex, type IndexedRecord } from './source-index-file.js';

export interface PersistentSourceIndex {
  /** Content-keyed facts passed to `scanRelations` as `cache`. */
  readonly cache: ParseCache;
  /** Tree-keyed resolved records passed to `scanRelations` as `reuse`. */
  readonly reuse: RecordCache;
  /** Atomically publish the facts this scan used; I/O failure is absorbed. */
  save(): Promise<void>;
}

/**
 * Open one versioned binary source-index generation from its immutable segments.
 *
 * A missing, incompatible, incomplete, or corrupt chain behaves as an empty
 * cache. It can make this scan slower and cannot change the resulting graph.
 */
export async function openSourceIndex(path: string): Promise<PersistentSourceIndex> {
  const stored = await readSourceIndex(path);
  const available = new Map(stored.records);
  const held: TreeShape | undefined = stored.config === undefined
    ? undefined
    : { config: stored.config, directories: stored.directories };
  const parses = new Map<Digest, Parsed>();
  const records = new Map<string, IndexedRecord>();
  let adopted: TreeShape | undefined;

  const cache: ParseCache = {
    get(digest) {
      const parsed = parses.get(digest) ?? stored.parses.get(digest);
      if (parsed !== undefined) parses.set(digest, parsed);
      return parsed;
    },
    set(digest, parsed) {
      parses.set(digest, parsed);
    },
    keep(digest) {
      const parsed = stored.parses.get(digest);
      if (parsed !== undefined) parses.set(digest, parsed);
    },
  };

  const reuse: RecordCache = {
    under(shape) {
      adopted = shape;
      prune(available, held, shape);
      records.clear();
    },
    get(file, digest) {
      if (adopted === undefined) return undefined;
      const found = records.get(file) ?? available.get(file);
      if (found?.record.digest !== digest) return undefined;
      records.set(file, found);
      return found.record;
    },
    set(record, witnesses) {
      if (adopted !== undefined && record.digest !== undefined) {
        records.set(record.file, { record, witnesses });
      }
    },
  };

  return {
    cache,
    reuse,
    async save() {
      await writeSourceIndex(path, {
        parses,
        ...(adopted?.config === undefined
          ? stored.config === undefined ? {} : { config: stored.config }
          : { config: adopted.config }),
        directories: adopted?.directories ?? stored.directories,
        records: adopted === undefined ? stored.records : records,
      });
    },
  };
}
