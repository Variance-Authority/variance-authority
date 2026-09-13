/**
 * What reading a file produced, keyed by its bytes and by how they were read.
 *
 * The expensive half of a scan is per file: open it, decode it, parse it, find
 * the component names in it. Nearly all of that is a pure function of the bytes,
 * so it is cacheable by content digest **forever** — not until something
 * invalidates it. A digest is not a guess about freshness the way a timestamp is;
 * two files with one digest had one content, on any machine, in any branch, in
 * any year.
 *
 * Nearly, because the same bytes are not read the same way under every name. The
 * extension picks the dialect the parser is handed and decides whether the file
 * is read as a stylesheet at all, and a name ending `.test.ts` is deliberately
 * not indexed for declarations. So the key is the digest together with what the
 * path said about reading it, and nothing else about the path is in it:
 * `src/Button.tsx` and `legacy/Button.tsx` holding one content still share one
 * entry, which is the sharing this cache exists for.
 *
 * That is what makes the cache shareable in the way that matters. A CI machine
 * that has never seen this branch still holds entries for every blob the branch
 * inherited, which is nearly all of them, and pays only for what the pull request
 * changed. Paired with digests read out of git ([`tree.ts`](./tree.ts)) the scan
 * never opens the files it hits on: the cost is the size of the diff and not the
 * size of the repository.
 *
 * ## What is not in here
 *
 * Resolution. Where `./button.css` *points* depends on the directory it was
 * written in, on `tsconfig` paths, and on what is installed — none of which is in
 * the file's bytes, and a cache keyed by those bytes that claimed to know it would
 * be wrong the first time a package moved. Specifiers go in; edges do not.
 */

import type { Export, Request } from './read.js';
import { openSourceIndexFile } from './source-index-file.js';

/**
 * A parse cache key: a content digest, and what the path said about reading it.
 *
 * Joined rather than re-hashed. The house pattern for a compound key is to hash
 * the tuple ([`taint/cache.ts`](./taint/cache.ts)), and it was declined here
 * against a measurement: this key is computed once per file in the repository on
 * every run — including the runs that open nothing — and hashing 24,909 of them
 * costs 17 ms of a warm run that takes 344. Joining them costs 2. Nothing ever
 * reads the parts back out, so the only thing a hash would buy is a fixed width,
 * and the string dictionary in the index is what would pay for it.
 *
 * Built by [`scan.ts`](./scan.ts), which is where the two properties are read.
 */
export type ParseKey = string;

/** Everything reading one file produced that does not depend on where it sits. */
export interface Parsed {
  readonly requests: readonly Request[];
  /**
   * The names this file publishes.
   *
   * Cacheable by content digest for the same reason the requests are: what a
   * file exports is in its own bytes. Which *file* is behind a re-export is not,
   * and that join happens after resolution.
   */
  readonly exports?: readonly Export[];
  readonly declares?: readonly string[];
  readonly unknown?: string;
}

export interface ParseCache {
  get(key: ParseKey): Parsed | undefined;
  set(key: ParseKey, parsed: Parsed): void;
  /**
   * This blob is still in the tree, though nothing asked what it said.
   *
   * A scan that reuses a whole record ([`reuse.ts`](./reuse.ts)) never opens the
   * file and never asks this cache anything, so a cache that pruned to what it
   * *answered* would throw away the entry for every unchanged file — and the
   * run that needs those entries is the next one, when a path appears and the
   * records are gone. The scan says the blob is live instead; keeping an entry
   * costs nothing to decide and is what makes the pruning above a statement
   * about the tree rather than about this run's luck.
   */
  keep?(key: ParseKey): void;
}

export interface PersistentParseCache extends ParseCache {
  /**
   * Write what this scan used back to disk.
   *
   * Only entries this scan read, wrote or kept survive, which is the whole of
   * the pruning story: a blob nothing referenced is a blob no branch holds any
   * more, and a cache that only ever grew would eventually cost more to load
   * than the parses it saves.
   */
  save(): Promise<void>;
}

/** A cache that keeps everything and remembers nothing between processes. */
export function memoryParseCache(): ParseCache {
  const entries = new Map<ParseKey, Parsed>();

  return {
    get: (key) => entries.get(key),
    set: (key, parsed) => void entries.set(key, parsed),
  };
}

/**
 * The cache at `path`, loaded if it is there and usable.
 *
 * Every failure is silent and produces an empty cache, because every failure
 * costs the same thing — a full scan, which is what would have happened anyway.
 * A cache that could fail a run would be a new way to break a build in exchange
 * for a saving.
 */
export async function openParseCache(path: string): Promise<PersistentParseCache> {
  const file = await openSourceIndexFile(path);
  const generation = file.stored;
  const stored = generation.parses;
  const used = new Map<ParseKey, Parsed>();

  return {
    get(key) {
      const parsed = used.get(key) ?? stored.get(key);
      // Reading counts as using. An entry hit by this scan is one the next scan
      // will want, and dropping it because nothing rewrote it would throw away
      // the whole unchanged repository on every run.
      if (parsed !== undefined) used.set(key, parsed);
      return parsed;
    },
    set(key, parsed) {
      used.set(key, parsed);
    },
    keep(key) {
      const parsed = stored.get(key);
      if (parsed !== undefined) used.set(key, parsed);
    },
    async save() {
      await file.save({ ...generation, parses: used });
    },
  };
}
