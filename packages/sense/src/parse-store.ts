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

import { execFileSync } from 'node:child_process';
import { extname, join } from 'node:path';
import { native as addon } from './addon.js';
import type { ParseCache, Parsed } from './cache.js';
import { READABLE } from './language.js';
import type { NativeBuilt, NativeGitTree } from './native.js';
import { decodeSourceIndex } from './source-index-format.js';
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
 * to, then the primary checkout's when that cache is another one. None where
 * git rewrites the bytes of a file the store parses.
 */
export function parseStoresFor(root: string): readonly string[] | undefined {
  // The top, not `root`: only it holds the `.git` that names a worktree's primary.
  const repository = repositoryRoot(root);
  if (rewritesParsed(repository)) return undefined;
  const own = cacheRootFor(repository);
  const primary = primaryCacheRoot(repository);
  return primary === own ? [parseStorePath(own)] : [parseStorePath(own), parseStorePath(primary)];
}

/**
 * Whether git writes a file the store would parse as other bytes than its blob:
 * a filter, `ident` or `working-tree-encoding` on it, `eol=crlf`,
 * `core.autocrlf=true`, or a `text` (or legacy `crlf`) file under `core.eol=crlf` (`native` on
 * Windows). A parse is kept under the blob's name and read off the disk, so
 * there two checkouts holding one blob can hold different modules, and one
 * would answer the other. A git that cannot answer is taken to rewrite. A
 * parse leaves its checkout only when the bytes read are the blob
 * (`native/src/parse_origin.rs`), so this gate saves such a checkout the
 * reads no other would take. The `FIXME` in `scan.ts` is the same question
 * for one checkout's own index.
 */
function rewritesParsed(repository: string): boolean {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const config = new Map<string, string>();
  try {
    // Git spells a boolean `true` however it was set (`yes`, `2`, a bare key) and keeps `input` and `crlf` as they are.
    for (const line of git('config', '--type=bool-or-str', '--get-regexp', '^core\\.(autocrlf|eol)$').split('\n')) {
      const [key, value = ''] = line.trim().toLowerCase().split(/\s+/);
      if (key) config.set(key, value);
    }
  } catch {
    // neither is set
  }
  const autocrlf = config.get('core.autocrlf');
  if (autocrlf === 'true') return true;
  const eol = config.get('core.eol') ?? 'native';
  const crlf = autocrlf !== 'input' && (eol === 'crlf' || (eol === 'native' && process.platform === 'win32'));
  try {
    const rewritten = [
      git('ls-files', '-z', '--', ':(top,attr:eol=crlf)', ...(crlf ? [':(top,attr:text)', ':(top,attr:text=auto)', ':(top,attr:crlf)'] : [])),
      git('ls-files', '-z', '--', ':(top)', ':(top,exclude,attr:!filter !ident !working-tree-encoding)'),
    ];
    return rewritten.join('\0').split('\0').some((file) => READABLE.has(extname(file)));
  } catch {
    return true;
  }
}

/**
 * Add to the first of `stores` what the published chain at `chain` holds, no
 * store does, and the scan that listed `listing` read from the blob git names
 * it by: what that scan parsed in JavaScript reaches the other roots this way.
 * A parse of other bytes — a file edited under `--assume-unchanged`, or after
 * the listing — stays in its own index. A store that cannot be written costs a
 * later root its reparse and nothing else, so it is not an error here.
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
