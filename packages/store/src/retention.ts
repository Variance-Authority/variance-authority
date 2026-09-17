// compass: variance-authority.retention

import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The bound on the render cache, applied by whoever owns the directory.
 *
 * The cache under `$XDG_CACHE_HOME/variance-authority/renders` is the one thing
 * this project writes that nothing was ever going to delete. It is outside the
 * work tree, so `git clean` does not reach it; it is under a dot-directory, so
 * nobody browses it; and every edit to a document mints a new key, so the old
 * one is dead the moment it is written — a run against a changed file never asks
 * for the previous document's image again. Left alone it is a directory that
 * only grows, in a place its owner has no reason to look. Three months of that
 * on one laptop is 348 MB, spread over identities that can no longer be
 * attributed to any checkout, and the only fix anyone had was knowing to `rm -rf`
 * a path they had never heard of.
 *
 * So the sweep runs itself, at the end of every run — including the runs that
 * never touch the directory, because a machine that has moved to CI against a
 * tribunal is precisely the machine whose leftover cache nothing would come back
 * for — and it says out loud when it took something.
 *
 * ## What survives
 *
 * **Age first.** An entry's mtime is the last run that *wanted* it —
 * `renderCache.get` touches on a hit — so an entry older than
 * {@link RenderCacheBound.maxAgeMs} is one that no run has asked for since. That
 * is not a guess about value: an image is addressed by the digest of the
 * document that produced it, so once the source moves the old key can never be
 * asked for again by anything. Dead keys are the bulk of a cache this size.
 *
 * **Size second.** What is left is cut to {@link RenderCacheBound.ceilingBytes}
 * oldest-first, which is a plain LRU and is here as the backstop: a suite wide
 * enough to blow the ceiling inside the age window is exactly the suite whose
 * owner would otherwise find out from a full disk.
 *
 * *What it costs.* The cache is keyed by renderer identity and an identity is a
 * machine, not a project — two checkouts that render with the same browser share
 * one directory and therefore one budget. A project you have not run in a
 * fortnight loses its entries to the age rule, and if the ceiling binds, a busy
 * project's renders evict an idle one's. The first run back is a full repaint,
 * which is a slow run and never a wrong one: a miss can only cost a render.
 *
 * *What it does not do.* It never touches baselines. This walks the cache root
 * only, which `variance run` keeps separate from the baseline root for exactly
 * this reason — a sweep that could reach an approved image would be a sweep
 * nobody could afford to run automatically.
 */

/** Two weeks: long enough to cover a holiday, short enough to notice. */
const DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Half a gigabyte, across every identity in the root. */
const DEFAULT_CEILING_BYTES = 512 * 1024 * 1024;

export interface RenderCacheBound {
  /**
   * How long an entry survives without being asked for. Default two weeks.
   *
   * Counted from the entry's mtime, which `renderCache.get` refreshes on every
   * hit — so this is time since something wanted the image, not time since it
   * was painted.
   */
  readonly maxAgeMs?: number;

  /** The total the root may hold after the age cut. Default 512 MiB. */
  readonly ceilingBytes?: number;

  /** The clock, so a test can age an entry without waiting a fortnight. */
  readonly now?: number;
}

/** What one sweep did, in the terms an operator would ask in. */
export interface RenderCacheSwept {
  /** The directory that was walked. */
  readonly root: string;
  /** Entries found, an entry being one document's image and its record. */
  readonly found: number;
  /** Entries deleted, by either rule. */
  readonly removed: number;
  /** Bytes reclaimed. */
  readonly freed: number;
  /** Bytes still held after the sweep. */
  readonly held: number;
  /** Identity directories still holding something. */
  readonly identities: number;
}

/**
 * Apply the bound to a render cache root.
 *
 * Never throws, for the render cache's reason one level up: everything in
 * here is regenerable, so a root that cannot be listed, an entry that cannot be
 * stat-ed and a file somebody else deleted mid-walk are all conditions whose
 * correct response is to carry on and report what was managed. A sweep that
 * could fail a run would be an optimisation that costs builds.
 */
export async function sweepRenderCache(
  root: string,
  bound: RenderCacheBound = {},
): Promise<RenderCacheSwept> {
  const maxAgeMs = bound.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const ceilingBytes = bound.ceilingBytes ?? DEFAULT_CEILING_BYTES;
  const now = bound.now ?? Date.now();

  const identities = await directoriesIn(root);
  const entries: Entry[] = [];
  for (const identity of identities) {
    entries.push(...(await entriesUnder(join(root, identity, 'by-document'))));
  }

  // Oldest first, so the age cut and the size cut are one pass down the same
  // list: everything the age rule takes is a prefix of what the size rule would
  // have taken next, and running them in the other order would re-sort.
  entries.sort((left, right) => left.touched - right.touched);

  const doomed: Entry[] = [];
  let held = entries.reduce((total, entry) => total + entry.bytes, 0);

  for (const entry of entries) {
    const stale = now - entry.touched > maxAgeMs;
    if (!stale && held <= ceilingBytes) break;
    doomed.push(entry);
    held -= entry.bytes;
  }

  let removed = 0;
  let freed = 0;
  for (const entry of doomed) {
    // Both halves, or neither: a `.png` without its `.json` reads as a corrupt
    // entry rather than an absent one, and `readRaster` is entitled to say so.
    if (await removeAll(entry.paths)) {
      removed += 1;
      freed += entry.bytes;
    } else {
      held += entry.bytes;
    }
  }

  // An identity nobody renders under any more — a browser that was upgraded, a
  // font that was installed — leaves an empty shell behind, and a directory
  // listing full of those is the thing that makes the cache look unexplained.
  let occupied = 0;
  for (const identity of identities) {
    if (await isEmptyTree(join(root, identity))) await removeAll([join(root, identity)]);
    else occupied += 1;
  }

  // And the root itself, once nothing is under it. A machine that has moved to
  // a tribunal renders nothing here again, so every entry ages out and what is
  // left is an empty directory named after this project in a place its owner
  // never chose — which is the shape of the complaint that started this file,
  // minus the bytes. The race against a run that writes between the check and
  // the removal costs that run one re-render, which is what any miss costs.
  if (occupied === 0 && (await isEmptyTree(root))) await removeAll([root]);

  return { root, found: entries.length, removed, freed, held, identities: occupied };
}

/** One document's cached render: the pair of files, their size, their last hit. */
interface Entry {
  readonly paths: readonly string[];
  readonly bytes: number;
  readonly touched: number;
}

/**
 * The entries in one identity's `by-document` directory.
 *
 * Grouped by the name without its extension, because the image and the record
 * are one entry and evicting half of one is worse than evicting all of it. The
 * record is the half that always exists — a subject with no pixels has no
 * `.png` — so it is the one the timestamp comes from.
 */
async function entriesUnder(directory: string): Promise<readonly Entry[]> {
  const halves = new Map<string, { paths: string[]; bytes: number; touched: number }>();

  for (const name of await namesIn(directory)) {
    const path = join(directory, name);
    const stem = name.replace(/\.(png|json)$/, '');
    if (stem === name) continue;

    let size: number;
    let mtime: number;
    try {
      const found = await stat(path);
      if (!found.isFile()) continue;
      size = found.size;
      mtime = found.mtimeMs;
    } catch {
      continue;
    }

    const entry = halves.get(stem) ?? { paths: [], bytes: 0, touched: 0 };
    entry.paths.push(path);
    entry.bytes += size;
    // The record's stamp wins where the two disagree: `put` writes the image
    // first, and a touch that reached one file and not the other would
    // otherwise pick whichever half was unluckier.
    if (name.endsWith('.json') || entry.touched === 0) entry.touched = mtime;
    halves.set(stem, entry);
  }

  return [...halves.values()];
}

async function namesIn(directory: string): Promise<readonly string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}

async function directoriesIn(root: string): Promise<readonly string[]> {
  try {
    const found = await readdir(root, { withFileTypes: true });
    return found.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Whether a directory holds no files at any depth. */
async function isEmptyTree(directory: string): Promise<boolean> {
  let found;
  try {
    found = await readdir(directory, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of found) {
    if (!entry.isDirectory()) return false;
    if (!(await isEmptyTree(join(directory, entry.name)))) return false;
  }
  return true;
}

/** Delete these paths, answering whether every one of them is now gone. */
async function removeAll(paths: readonly string[]): Promise<boolean> {
  for (const path of paths) {
    try {
      await rm(path, { recursive: true, force: true });
    } catch {
      return false;
    }
  }
  return true;
}
