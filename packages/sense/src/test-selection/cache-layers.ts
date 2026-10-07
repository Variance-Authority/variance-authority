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
 *   coverage.bin, suites/                 the base: the primary checkout's own
 *   .work/<workspace>/                    one per worktree
 *     coverage.bin, suites/
 * ```
 *
 * A worktree reads both layers and writes only its own. That is the whole of the
 * safety argument and it is the same argument as before: the base is read-only
 * to everyone who is not the primary checkout, so no two writers ever address
 * one byte. Nothing was given up to gain the sharing.
 *
 * `.work` is dotted for the reason a run's scratch segments are
 * `.run-<pid>-<uuid>`: nothing a caller names begins with a dot.
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

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { digestString } from '../digest.js';
import { repositoryRoot } from './repository-root.js';

/** The file a repository names its cache directory in, at its root. */
export const CACHE_CONFIG = 'variance.config.json';

/** The variable that names the cache directory itself, for a caller isolating its runs. */
export const CACHE_VARIABLE = 'VARIANCE_AUTHORITY_CACHE';

const configs = new Map<string, RootConfig | undefined>();

/**
 * The {@link CACHE_CONFIG} at a repository's root, parsed.
 *
 * `file` is carried so a reader that refuses a value can name where it came
 * from. `value` is the object the file holds; a file that holds anything else
 * sets nothing, and the CLI, which owns the whole file, says why.
 */
export interface RootConfig {
  readonly file: string;
  readonly value: Readonly<Record<string, unknown>>;
}

/**
 * The root config of the repository `root` is in, or undefined when there is none.
 *
 * Read once per process: every seam asks it per module, and the file does not
 * change under a run. Only this module and `suites.ts` read it, each for its own
 * key; the rest of the file is the CLI's, and the CLI refuses what it does not
 * know. A file that is not JSON is an error rather than no file, because the
 * setting it would have made is one the reader never sees.
 */
export function rootConfig(root: string): RootConfig | undefined {
  return configOf(repositoryRoot(root));
}

/** {@link rootConfig} for a directory known to be a checkout's root. */
function configOf(repository: string): RootConfig | undefined {
  if (!configs.has(repository)) configs.set(repository, readRootConfig(repository));

  return configs.get(repository);
}

/**
 * The directory everything variance-authority caches for `root` lives in.
 *
 * The repository owns the answer, in `cacheRoot` of the {@link CACHE_CONFIG}
 * at its root, resolved against that root. Without the key it is
 * `VARIANCE_AUTHORITY_CACHE` when that is an absolute path, and
 * `node_modules/.cache/variance-authority` under the repository root otherwise.
 *
 * The default is inside the checkout because the checkout is the one place
 * every party that runs here may write. A coding agent's sandbox allows writes
 * in the working tree and refuses `~/.cache`; a user cache would leave the
 * agent reading a recording it can never refresh, and a write that fails there
 * reads back as a stale answer rather than as an error. `XDG_CACHE_HOME` is not
 * consulted: a harness sets it for its own reasons, and honouring it split one
 * repository's recording across as many directories as there were harnesses.
 * `VARIANCE_AUTHORITY_CACHE` is ours, so only a caller who means this cache sets
 * it — a test suite keeping its runs out of the checkout's recording.
 * `node_modules/.cache` is ignored by every project's `.gitignore`, by Vitest's
 * watcher and by file watchers already, so a write during a run is seen by
 * nothing that would react to it.
 *
 * A `cacheRoot` that is not a path is an error rather than a default, because
 * the cache a run would fall back to is one the reader never sees.
 */
export function cacheRootFor(root: string): string {
  return cacheRootOf(repositoryRoot(root));
}

/**
 * The cache directory of the checkout `here` was cut from: {@link cacheRootFor}
 * its primary checkout, and `here`'s own when it was cut from none.
 *
 * A worktree's primary checkout is read from git's own layout — the directory
 * holding the git directory the worktree points into — so it is that
 * checkout's root already, and git is not started to say so a second time.
 */
export function primaryCacheRoot(here: string): string {
  const primary = primaryCheckout(here);

  return primary === here ? cacheRootFor(here) : cacheRootOf(primary);
}

/** {@link cacheRootFor} for a directory known to be a checkout's root. */
function cacheRootOf(repository: string): string {
  const config = configOf(repository);
  const named = config === undefined ? undefined : cacheRootIn(config);
  if (named !== undefined) return named;
  const isolated = process.env[CACHE_VARIABLE];
  if (isolated !== undefined && isAbsolute(isolated)) return resolve(isolated);

  return resolve(repository, 'node_modules', '.cache', 'variance-authority');
}

function cacheRootIn({ file, value: config }: RootConfig): string | undefined {
  const value = config['cacheRoot'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${file}: "cacheRoot" must be a directory path, not ${JSON.stringify(value)}`);
  }

  return resolve(dirname(file), value);
}

function readRootConfig(repository: string): RootConfig | undefined {
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
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not JSON, so the settings it holds cannot be read: ${(error as Error).message}`);
  }

  return {
    file,
    value: typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {},
  };
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
  const base = resolve(cacheRoot ?? primaryCacheRoot(here), 'test-selection', keyOf(primary));
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

/** The directory name a checkout's layer is kept under: its path, digested. */
export function checkoutKey(checkout: string): string {
  return digestString(checkout).replace(/^[^:]+:/, '');
}

const keyOf = checkoutKey;

/** The file a layer names its checkout in, so the cache can ask whether the checkout is still there. */
export const CHECKOUT_MARKER = 'checkout.json';

/** What {@link CHECKOUT_MARKER} holds. */
export interface CheckoutMarker {
  /** The checkout that writes this layer, spelled as the key was spelled from it. */
  readonly checkout: string;
  /** The checkout it was cut from; the same path in the primary checkout. */
  readonly primary: string;
}

/**
 * Write down which checkout a layer belongs to.
 *
 * A layer is named by a digest of its checkout's path, and a digest cannot be
 * read back into a path. Without this the cache holds thousands of directories
 * and can say of none of them whether the checkout that wrote it still exists,
 * so nothing can be removed on a fact and everything can only be aged out. The
 * file is rewritten by every run that records, which makes its mtime the time
 * the layer was last written.
 *
 * Called by the writers, never by {@link cacheLayers}: a command that only reads
 * the cache must leave it as it found it. Silent on failure, because a layer
 * with no marker is kept until it is old, which is what happened before this
 * file existed.
 */
export function markCheckout(root: string, cacheRoot?: string): void {
  const checkout = resolve(root);
  const { top } = cacheLayers(checkout, cacheRoot);
  const marker: CheckoutMarker = { checkout, primary: primaryCheckout(checkout) };
  try {
    mkdirSync(top, { recursive: true });
    writeFileSync(resolve(top, CHECKOUT_MARKER), `${JSON.stringify(marker)}\n`);
  } catch { /* the layer is kept until it is old, as before */ }
}

/** The checkout a layer names, or undefined when it names none or cannot be read. */
export function readCheckoutMarker(layer: string): CheckoutMarker | undefined {
  try {
    const value = JSON.parse(readFileSync(resolve(layer, CHECKOUT_MARKER), 'utf8')) as Partial<CheckoutMarker>;
    return typeof value.checkout === 'string' && typeof value.primary === 'string'
      ? { checkout: value.checkout, primary: value.primary }
      : undefined;
  } catch {
    return undefined;
  }
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
export function primaryCheckout(here: string): string {
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
