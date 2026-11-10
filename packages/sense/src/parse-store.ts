/**
 * The parses a cache keeps for every root it indexes, under the bytes and the
 * way they were read and nothing else (`native/src/parse_store.rs`).
 *
 * A checkout, a directory in it and a worktree cut from it read the same
 * bytes; the first to parse a module answers the rest. What is kept is
 * reclaimed by reachability, as `git gc` keeps what a ref names: the root
 * chains in the cache are the refs.
 */

// compass: variance-authority.reach.source-index

import { join } from 'node:path';
import { native as addon } from './addon.js';
import type { ParseCache, Parsed } from './cache.js';
import type { NativeBuilt, NativeGitTree } from './native.js';
import { decodeSourceIndex } from './source-index-format.js';
import { cacheRootFor, directoriesIn, primaryCacheRoot, workDirectory } from './test-selection/cache-layers.js';

/** A day: longer than any update takes between adding to the store and publishing the root that names what it added. */
export const PARSE_STORE_GRACE_MS = 24 * 60 * 60 * 1000;

/** The parse store of the cache at `cacheRoot`. A dot directory, so the cache prune does not take it for a checkout's. */
export function parseStorePath(cacheRoot: string): string {
  return join(cacheRoot, 'test-selection', '.parses', 'parses.bin');
}

/**
 * The stores an update of `root` reads: its own cache's first, which it adds
 * to, then the primary checkout's when that cache is another one.
 */
export function parseStoresFor(root: string): readonly string[] {
  const own = cacheRootFor(root);
  const primary = primaryCacheRoot(root);
  return primary === own ? [parseStorePath(own)] : [parseStorePath(own), parseStorePath(primary)];
}

/**
 * Add to the first of `stores` what the published chain at `chain` holds and no
 * store does: what a scan parsed in JavaScript reaches the other roots this way.
 * A store that cannot be written costs a later root its reparse and nothing
 * else, so it is not an error here.
 */
export function fillParseStore(stores: readonly string[], chain: string): number {
  if (stores.length === 0) return 0;
  try {
    return addon()?.fillParseStore([...stores], chain) ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Drop from the cache's parse store every parse no root chain in the cache
 * names, past `graceMs` since it was added; how many went.
 */
export async function pruneParseStore(
  cacheRoot: string,
  options: { readonly graceMs?: number } = {},
): Promise<{ readonly dropped: number }> {
  const scanner = addon();
  if (scanner === undefined) return { dropped: 0 };
  const chains = await rootChains(join(cacheRoot, 'test-selection'));
  return { dropped: scanner.pruneParseStore(parseStorePath(cacheRoot), chains, options.graceMs ?? PARSE_STORE_GRACE_MS) };
}

/** Every checkout's chain under `selection`, and every worktree's under it. */
async function rootChains(selection: string): Promise<string[]> {
  const chains: string[] = [];
  for (const checkout of await directoriesIn(selection)) {
    const base = join(selection, checkout);
    chains.push(join(base, 'source-index.bin'));
    for (const worktree of await directoriesIn(workDirectory(base))) chains.push(join(workDirectory(base), worktree, 'source-index.bin'));
  }
  return chains;
}

/** A row the scan answered as kept whose parse the cache did not find. */
export interface Unheld {
  readonly file: string;
  readonly key: string;
  readonly fresh: NativeBuilt;
}

/**
 * Put in `cache` the parse of each row the scan of `tree` kept, and hand it on.
 *
 * The cache read the stores before the scan did, and another root may have
 * published them between the two: the parse comes from the tree's own reading,
 * the one the scan answered `kept` from, so a record is never published without it.
 */
export function handOverKept(
  tree: NativeGitTree,
  stores: readonly string[] | undefined,
  cache: ParseCache,
  rows: readonly Unheld[],
  handOver: (file: string, read: Parsed | undefined, key: string, targets?: readonly (string | undefined)[]) => void,
): void {
  if (rows.length === 0 || stores === undefined) return;
  const digests = rows.map((row) => row.fresh.record.digest!);
  const parses = decodeSourceIndex(tree.keptParses([...stores], rows.map((row) => row.file), digests)).parses;
  for (const { file, key, fresh } of rows) {
    const parse = parses.get(key);
    if (parse !== undefined) cache.set(key, parse);
    handOver(file, parse, key, fresh.targets);
  }
}
