/**
 * Where a checkout keeps its cache, and where it reads one it did not write.
 *
 * Everything under `test-selection` has always been keyed by a digest of the
 * checkout's absolute path. That answers one question — *may these two processes
 * write to the same bytes* — correctly and completely: two checkouts never
 * share, so two agents working in two worktrees cannot corrupt each other's
 * index, and nothing has to be locked for that to hold.
 *
 * It answers the other question badly. A worktree created this morning is a
 * checkout of a repository that has been instrumented for months, and under a
 * key that is its own path it inherits none of it: the first run in a new
 * worktree re-transforms a world that is already sitting on disk a directory
 * away. An agent that exists for an afternoon spends most of it rebuilding what
 * the checkout it was cut from already knew.
 *
 * So the path splits into two. A *repository* has one base — the primary
 * checkout's directory, unchanged, still exactly where it was — and every other
 * checkout of it gets a directory of its own beneath that base:
 *
 * ```
 * <cache>/test-selection/<repository>/
 *   coverage.bin, names.bin, <label>/     the base: the primary checkout's own
 *   .work/<workspace>/                    one per worktree
 *     coverage.bin, names.bin, <label>/
 * ```
 *
 * A worktree reads both layers and writes only its own. That is the whole of the
 * safety argument and it is the same argument as before: the base is read-only
 * to everyone who is not the primary checkout, so no two writers ever address
 * one byte. Nothing was given up to gain the sharing.
 *
 * `.work` is dotted because the sibling of these directories is a
 * {@link recordStore} label, and a label is caller-chosen — a bundler plugin's
 * word, or a Jest project id. A dot cannot begin one, which is the same reason
 * a run's scratch segments are already `.run-<pid>-<uuid>`.
 *
 * ## Why the base is the primary checkout and not the git directory
 *
 * The repository could be keyed by anything stable — the common git directory
 * would do. Keying it by the primary checkout's path means the primary
 * checkout's cache is where it has always been, byte for byte, so a repository
 * that has been recording for months keeps its index across this change rather
 * than starting cold to gain a feature about not starting cold.
 */

// compass: variance-authority.reach

import { cpSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { digestString } from '../digest.js';
import { repositoryRoot } from './repository-root.js';

/** The file a repository names its cache directory in, at its root. */
export const CACHE_CONFIG = 'variance.config.json';

const configured = new Map<string, string | undefined>();

/**
 * The directory everything variance-authority caches for `root` lives in.
 *
 * The repository owns the answer, in `cacheRoot` of the {@link CACHE_CONFIG}
 * at its root, resolved against that root. It beats the environment on
 * purpose: a sandboxed agent that may not write `~/.cache` sets
 * `XDG_CACHE_HOME` to a temporary directory, and a project that named a
 * directory inside its checkout must not have its recording split by that.
 * Without the key it is `variance-authority` under `XDG_CACHE_HOME`, or under
 * `~/.cache` when that is unset, empty or relative — the XDG specification
 * requires an absolute path, and a relative one would resolve against
 * whichever directory the run started in.
 *
 * Only `cacheRoot` is read here. The rest of the file is the CLI's, and the
 * CLI refuses what it does not know; a file this cannot parse, or a
 * `cacheRoot` that is not a path, is an error rather than a default, because
 * the cache a run would fall back to is one the reader never sees.
 */
export function cacheRootFor(root: string): string {
  const repository = repositoryRoot(root);
  if (!configured.has(repository)) configured.set(repository, readCacheRoot(repository));
  const named = configured.get(repository);
  if (named !== undefined) return named;
  const xdg = process.env['XDG_CACHE_HOME'];

  return resolve(xdg !== undefined && isAbsolute(xdg) ? xdg : resolve(homedir(), '.cache'), 'variance-authority');
}

function readCacheRoot(repository: string): string | undefined {
  const file = resolve(repository, CACHE_CONFIG);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let value: unknown;
  try {
    value = (JSON.parse(text) as { cacheRoot?: unknown } | null)?.cacheRoot;
  } catch (error) {
    throw new Error(`${file} is not JSON, so the cache directory it names cannot be read: ${(error as Error).message}`);
  }
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${file}: "cacheRoot" must be a directory path, not ${JSON.stringify(value)}`);
  }

  return resolve(repository, value);
}

/**
 * The directories one checkout reads, nearest first.
 *
 * `top` is the only one anything writes to. `base` is the repository's, and in
 * the primary checkout the two are the same directory — which is what makes the
 * cascade invisible there: one layer, written and read, as before.
 */
export interface CacheLayers {
  /** This checkout's own directory: the only one a run of it writes. */
  readonly top: string;
  /** The repository's shared directory. Equal to {@link top} in the primary checkout. */
  readonly base: string;
}

/**
 * Both layers for a checkout.
 *
 * Resolving which checkout this is means asking the filesystem, and the callers
 * are path functions that a transform calls per module, so the answer is held:
 * a checkout does not become a different checkout while a process runs, and the
 * cost is one small read for the first module of a build.
 */
export function cacheLayers(root: string, cacheRoot?: string): CacheLayers {
  const here = resolve(root);
  const primary = primaryCheckout(here);
  const base = resolve(cacheRoot ?? cacheRootFor(primary), 'test-selection', keyOf(primary));
  if (primary === here) return { top: base, base };
  // Each checkout reads its own `cacheRoot`: a relative one names a directory
  // inside the worktree, which is the one directory a sandboxed agent may write.
  const own = resolve(cacheRoot ?? cacheRootFor(here), 'test-selection', keyOf(primary));

  return { top: resolve(own, '.work', keyOf(here)), base };
}

/**
 * The layers for a record whose names are spelled from the repository.
 *
 * A coverage snapshot, the module-name table and a record store all hold
 * repository-relative names, so they belong to the checkout rather than to
 * whichever directory asked: a recorder started from a package and a reader
 * started from the repository root must land on one directory, or the reader
 * reports no record for a suite that has one. {@link repositoryRoot} is the
 * owner of that answer, and every writer already asks it; this is the same
 * question asked on the read side. The source index is not one of these — its
 * records are a scan root's, and two roots in one repository keep two.
 */
export function repositoryLayers(root: string, cacheRoot?: string): CacheLayers {
  return cacheLayers(repositoryRoot(root), cacheRoot);
}

/** The layers to read for one artifact, nearest first; one entry in the primary checkout. */
export function layeredFiles(layers: CacheLayers, name: string): readonly string[] {
  return layers.top === layers.base
    ? [resolve(layers.base, name)]
    : [resolve(layers.top, name), resolve(layers.base, name)];
}

function keyOf(checkout: string): string {
  return digestString(checkout).replace(/^[^:]+:/, '');
}

const primaries = new Map<string, string>();

/**
 * The checkout a worktree was cut from, or the argument when it was not cut.
 *
 * A worktree's `.git` is a file naming the directory git keeps its state in,
 * which for a worktree lies under the primary checkout's own git directory. Two
 * segments of that path are the answer, and every other shape — `.git` a real
 * directory, `.git` absent because this is not a checkout at all — means the
 * argument is already the primary one. A path that cannot be read is not an
 * error here: a checkout whose lineage cannot be established is a checkout that
 * keeps its own cache, which is where it started.
 */
function primaryCheckout(here: string): string {
  const held = primaries.get(here);
  if (held !== undefined) return held;
  const found = readPrimary(here);
  primaries.set(here, found);

  return found;
}

function readPrimary(here: string): string {
  let pointer: string;
  try {
    pointer = readFileSync(resolve(here, '.git'), 'utf8');
  } catch {
    return here;
  }
  const named = /^gitdir:\s*(.+?)\s*$/mu.exec(pointer)?.[1];
  if (named === undefined) return here;
  const gitDirectory = isAbsolute(named) ? resolve(named) : resolve(here, named);
  // `<primary>/.git/worktrees/<name>`: the two segments below the git directory
  // are git's bookkeeping, and what is above it is the checkout that owns them.
  const worktrees = dirname(gitDirectory);

  return basename(worktrees) === 'worktrees' && basename(dirname(worktrees)) === '.git'
    ? dirname(dirname(worktrees))
    : here;
}

/**
 * Give this checkout the base's copy of an artifact it has none of.
 *
 * For the artifacts a worktree may not merely read across: a numbering
 * authority. `names.bin` assigns each path an id counted up from the size of
 * the table, and that id is baked into the emitted code and joined against by
 * every record store. A worktree that read the base's table without taking it
 * over would number its own new paths from zero and mean, by id 7, a different
 * file than the base does — silently, and in the direction that makes a run
 * attribute one module's crossings to another. Taking the table over continues
 * its count, so every id the base assigned still means what it meant and no new
 * one repeats it.
 *
 * Copied through a temporary name and renamed into place, because the reader is
 * synchronous and forgiving: a chain it cannot parse is an empty table, and an
 * empty table is precisely the renumbering this exists to prevent. A reader must
 * see the whole chain or none of it, never half.
 *
 * Silent on every failure. An artifact that could not be seeded is an artifact
 * this checkout builds for itself, which is what it would have done anyway.
 */
export function seedFromBase(layers: CacheLayers, names: readonly string[]): void {
  if (layers.top === layers.base) return;
  for (const name of names) {
    const to = resolve(layers.top, name);
    const from = resolve(layers.base, name);
    if (existsSync(to) || !existsSync(from)) continue;
    const staging = `${to}.${process.pid.toString(16)}.seed`;
    try {
      cpSync(from, staging, { recursive: true });
      renameSync(staging, to);
    } catch {
      // Somebody else got there first, or there was nothing to take.
      try {
        rmSync(staging, { recursive: true, force: true });
      } catch { /* the staging copy outlives this run at worst */ }
    }
  }
}
