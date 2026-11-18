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
import type { NativeGitTree } from './native.js';
import { cacheRootFor, directoriesIn, primaryCacheRoot, workDirectory } from './test-selection/cache-layers.js';
import { repositoryRoot } from './test-selection/repository-root.js';

/** A day: longer than any update takes between adding to the store and publishing the root that names what it added. */
export const PARSE_STORE_GRACE_MS = 24 * 60 * 60 * 1000;

/** The parse store of the cache at `cacheRoot`. A dot directory, so the cache prune does not take it for a checkout's. */
export function parseStorePath(cacheRoot: string): string {
  return join(cacheRoot, 'test-selection', '.parses', 'parses.bin');
}

/**
 * The stores an update of `root` reads: its own cache's first, which it adds
 * to, then the primary checkout's when that cache is another one. Native
 * acquisition proves the identity before reusing a parse of worktree bytes.
 */
export function parseStoresFor(root: string): readonly string[] {
  // The top, not `root`: only it holds the `.git` that names a worktree's primary.
  const repository = repositoryRoot(root);
  const own = cacheRootFor(repository);
  const primary = primaryCacheRoot(repository);
  return primary === own ? [parseStorePath(own)] : [parseStorePath(own), parseStorePath(primary)];
}

/**
 * Add to the first of `stores` what the published chain at `chain` holds, no
 * store does, and `listing` read only as the blob git names it by. A parse of
 * other bytes — a file edited under `--assume-unchanged`, or after the
 * listing — stays in its own index, and so does a module read under
 * `packs: false`, whose bytes the listing never saw. A store that cannot be
 * written costs a later root its reparse and nothing else, so it is not an error here.
 */
export function fillParseStore(listing: NativeGitTree | undefined, stores: readonly string[], chain: string): number {
  try {
    return listing?.fillParseStore([...stores], chain) ?? 0;
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
