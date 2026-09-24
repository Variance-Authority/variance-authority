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

import type { SourceSymbol } from './harvest.js';
import type { Export, Request } from './read.js';
import type { ImportDiff } from './taint/index.js';
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
 * Built by [`files.ts`](./files.ts), which is where the two properties are read.
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
  readonly symbols?: readonly SourceSymbol[];
  /** Declaration facts were requested, including when this file declared none. */
  readonly harvested?: true;
  readonly declares?: readonly string[];
  /** What the file mocks and loads for real, as `mockTaint` reads it. Absent when it does neither. */
  readonly mocks?: ImportDiff;
  readonly unknown?: string;
}

/** Content-addressed parses used by a scan and by consumers sharing its work. */
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

/**
 * How many parses the in-memory cache holds at once.
 *
 * The number exists because this cache has one job inside a single scan and it
 * is a small one. Its key is the content digest, so the only thing it can answer
 * is *another file in this repository holds these exact bytes, read the same
 * way* — and that is rare. Measured over this repository, honouring the scan's
 * own refusal to descend into a nested checkout: 1,420 readable files, 1,402
 * distinct keys, **18 repeat reads — 1.27%**. Measured over a 200,000-file tree
 * where every file carries its own index in its bytes, it is **zero**: 202,226
 * writes, not one read.
 *
 * Unbounded it is the largest structure in a large scan, and it is live: nothing
 * can collect it. On that tree a finished scan holds **829.6 MiB** of live heap
 * with it and **163.3 MiB** without — the graph itself, 202,226 records and
 * 1,210,225 edges, is the smaller half — and peak resident memory is 2,629 MiB
 * against 1,199 MiB. Bounded here it costs a few tens of megabytes and still
 * catches what duplicates in a repository actually look like — a vendored copy,
 * a generated pair, a file and its backup — which arrive next to each other in
 * the walk.
 *
 * The bound does not apply to the cache on disk below, which is a different
 * cache doing a different job: that one is answering across *runs*, where the
 * hit rate is the unchanged repository and pruning it would throw away the
 * saving it exists for.
 */
export const MEMORY_PARSE_ENTRIES = 4096;

/**
 * A cache that remembers nothing between processes, and only the recent within
 * one.
 *
 * `get` returning nothing is always a correct answer — the caller reads the file
 * — so a bound here cannot make a scan wrong, only slower by the parses it drops.
 * The one caller that notices is a scan reusing whole records
 * ([`scan.ts`](./scan.ts)) and handing every file's parse to `parsed`: a record
 * reused without opening the file has no parse in hand, and looks for it here.
 * That pairing wants the cache on disk, because a record cache spanning runs and
 * a parse cache that forgets at exit already disagree about what they are for.
 */
export function memoryParseCache(limit: number = MEMORY_PARSE_ENTRIES): ParseCache {
  const entries = new Map<ParseKey, Parsed>();

  return {
    get: (key) => entries.get(key),
    set: (key, parsed) => {
      entries.set(key, parsed);
      // `Map` iterates in insertion order, so the first key is the oldest. Age
      // rather than use, because a hit here is a file's twin and twins are
      // neighbours in a walk: re-ordering on every hit would cost every scan
      // something to serve the one percent that is not adjacent.
      if (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done !== true) entries.delete(oldest.value);
      }
    },
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
