/**
 * Content digests for the whole repository, from git, without reading a file.
 *
 * A scan needs two things per file: a digest, to know whether it moved, and its
 * imports. Computing the digest the obvious way costs a read of every file in the
 * repository, which at four hundred files is nothing and at two hundred thousand
 * is the scan.
 *
 * Git already did it. Every blob in a tree is named by the hash of its contents —
 * that is what a git object *is* — so `ls-tree -r` hands over the entire file list
 * with a content digest attached, in one subprocess, having opened nothing. Paired
 * with a cache keyed by that digest ([`cache.ts`](./cache.ts)), a scan reads only
 * the files whose blob changed: `O(diff)` rather than `O(repository)`.
 *
 * ## The working tree is not the commit
 *
 * `ls-tree` describes `HEAD`. A developer's checkout has edits in it, and using
 * the committed digest for an edited file would be the one unforgivable error —
 * a file that moved, reported as still. So the porcelain status is read too, and
 * every path it names is re-hashed from disk by `hash-object`, which produces the
 * same kind of digest for the bytes that are actually there. A file edited back to
 * its committed contents therefore lands on its committed digest, and nothing runs
 * for it.
 *
 * Deleted paths are dropped rather than carried, and a path git does not know
 * about at all gets no digest — the scan hashes those itself.
 */

import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { digestString, type Digest } from './digest.js';
import { native, type NativeGitTree } from './native.js';
import { directoriesOf } from './witness.js';
import { MAX_OUTPUT, workingTreeChanges } from './working-tree-changes.js';

const run = promisify(execFile);

/**
 * Every tracked path under `root`, with the digest of the bytes on disk.
 *
 * `undefined` when this is not a git checkout, or when git cannot answer. Not an
 * error: the scanner's own digest is correct and merely slower, and a tool that
 * refused to run outside a repository would be useless in exactly the tarball and
 * sandbox cases it should handle quietly.
 */
export async function gitDigests(
  root: string,
  changed?: readonly string[],
): Promise<ReadonlyMap<string, Digest> | undefined> {
  const [listed, located] = await Promise.allSettled([
    run('git', ['ls-tree', '-r', '-z', 'HEAD', '--', '.'], { cwd: root, maxBuffer: MAX_OUTPUT }),
    run('git', ['rev-parse', '--show-prefix'], { cwd: root, maxBuffer: MAX_OUTPUT }),
  ]);
  if (located.status === 'rejected') return undefined;
  let prefix = located.value.stdout;
  // A repository with no commit yet has no tree to list, and that is an empty
  // listing rather than an unanswerable one: `status` names every file as added
  // or untracked, and the overlay hashes each of them from disk.
  let listing: string;
  if (listed.status === 'fulfilled') listing = listed.value.stdout;
  else if (await unborn(root)) listing = '';
  else return undefined;
  prefix = prefix.trim();

  const digests = new Map<string, Digest>();
  for (const entry of listing.split('\0')) {
    // `<mode> <type> <object>\t<path>`, and only blobs are files.
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;

    const fields = entry.slice(0, tab).split(' ');
    if (fields[1] !== 'blob' || fields[2] === undefined) continue;

    const path = entry.slice(tab + 1);
    const relative = prefix === '' ? path : path.startsWith(prefix) ? path.slice(prefix.length) : path;
    digests.set(relative, blob(fields[2]));
  }

  if (changed === undefined) await overlayWorkingTree(root, digests, prefix === '');
  else await overlayKnownChanges(root, digests, changed);

  return digests;
}

/** Whether `HEAD` names a branch nobody has committed to yet; asked only after `ls-tree` failed. */
async function unborn(root: string): Promise<boolean> {
  try {
    await run('git', ['rev-parse', '--quiet', '--verify', 'HEAD'], { cwd: root });
    return false;
  } catch {
    return true;
  }
}

/** Apply an authoritative file list without asking Git to rediscover it. */
async function overlayKnownChanges(
  root: string,
  digests: Map<string, Digest>,
  changed: readonly string[],
): Promise<void> {
  const paths = [...new Set(changed)];
  for (const path of paths) {
    if (path === '' || isAbsolute(path) || path.split('/').includes('..')) {
      throw new Error(`known changed path must be scan-root-relative: ${path}`);
    }
    // Remove first: a missing hash means deletion, unreadability, or a file that
    // vanished while the caller's event was being handled. All three must stop
    // the committed object name from claiming the old bytes are still present.
    digests.delete(path);
  }
  for (const [path, digest] of await hashOnDisk(root, await filesAmong(root, paths))) digests.set(path, digest);
}

/**
 * Replace the committed digest of every path the working tree disagrees about.
 *
 * Failure here removes the disagreeing paths rather than leaving them: a stale
 * digest on an edited file is a subject nobody observes, and no digest at all is
 * a file the scan hashes for itself.
 */
async function overlayWorkingTree(root: string, digests: Map<string, Digest>, top: boolean): Promise<void> {
  const changes = await workingTreeChanges(root, top);
  if (changes === undefined) {
    digests.clear();
    return;
  }
  for (const path of changes.gone) digests.delete(path);
  // Removed before the refill, so a path that hashes nothing — not a file,
  // unreadable, or vanished between the two calls — hands the question back to
  // the scan rather than keeping a committed digest for contents nobody saw.
  for (const path of changes.changed) digests.delete(path);
  for (const [path, digest] of await hashOnDisk(root, await filesAmong(root, changes.changed))) digests.set(path, digest);
}

/**
 * The paths that are files on disk, following a link as `hash-object` does.
 *
 * A submodule `status` names without a trailing slash, or a link to a directory
 * or to nothing, fails `hash-object` for the whole batch, and a failed batch
 * withdraws every edited file's digest with its own. Asked of the disk because
 * the disk is what `hash-object` reads.
 */
async function filesAmong(root: string, paths: readonly string[]): Promise<string[]> {
  const files = await Promise.all(paths.map(async (path) => {
    try {
      return (await stat(join(root, path))).isFile() ? path : undefined;
    } catch {
      return undefined;
    }
  }));
  return files.filter((path): path is string => path !== undefined);
}

/**
 * Blob digests for the bytes currently on disk.
 *
 * One subprocess for every path, because `hash-object` reads its list from stdin.
 * The paths come back in the order they went in, which is the only thing pairing
 * them — `hash-object` prints digests and nothing else.
 */
async function hashOnDisk(
  root: string,
  paths: readonly string[],
): Promise<ReadonlyMap<string, Digest>> {
  const hashed = new Map<string, Digest>();
  if (paths.length === 0) return hashed;

  let stdout: string;
  try {
    const child = run('git', ['hash-object', '--stdin-paths'], {
      cwd: root,
      maxBuffer: MAX_OUTPUT,
    });
    child.child.stdin?.end(`${paths.join('\n')}\n`);
    ({ stdout } = await child);
  } catch {
    return hashed;
  }

  const lines = stdout.split('\n').filter((line) => line !== '');
  // A short answer means git stopped early, on a path that went away or could
  // not be opened after `filesAmong` saw it. Pairing the survivors by position
  // would attach one file's digest to another's name, so the whole batch is
  // discarded instead.
  if (lines.length !== paths.length) return hashed;

  for (const [at, line] of lines.entries()) hashed.set(paths[at]!, blob(line.trim()));

  return hashed;
}

/**
 * A git object name as a digest.
 *
 * Prefixed, because this repository's own digests are `v1:` and the two schemes
 * must never be compared as though they were one. A closure computed from git
 * digests and one computed from read contents differ at every node, which costs a
 * whole run and cannot cause a missed one.
 */
function blob(object: string): Digest {
  return `git:${object}`;
}

/**
 * The path set, as the questions a scan actually asks of it.
 *
 * A scan does not want the listing. It wants one digest at a time, the handful
 * of paths that decide how resolution is configured, one digest per directory,
 * and one digest over the whole set for the case where nothing bounds a bare
 * specifier. Four questions, three of them folds — and a fold whose input is
 * four hundred thousand paths is the reason a cold scan spends its first
 * seconds building `Map`s before a file has been opened.
 *
 * So the path set is an interface rather than a `Map`. The native implementation
 * answers all four without the listing crossing into JavaScript at all; the
 * JavaScript one answers them over a `Map` and is what a caller supplying its
 * own digests gets. Both are the same answers — `tree.test.ts` compares them.
 */
export interface Tree {
  /** The native snapshot, when this tree did not cross into JavaScript. */
  readonly native?: NativeGitTree;
  /** Seed paths discovered alongside native repository identity. */
  readonly seeds?: readonly string[];
  /** How many paths the tree holds. */
  readonly size: number;
  /** The digest of one path's bytes on disk. */
  get(path: string): Digest | undefined;
  /** Digests for many paths, in their input order. */
  getAll(paths: readonly string[]): readonly (Digest | undefined)[];
  /** Every path, sorted by code unit. The one answer that is repository-sized. */
  paths(): readonly string[];
  /** Every path whose basename is one of `names`, or is a `tsconfig*.json`. */
  named(names: readonly string[]): readonly string[];
  /** Every directory in the tree, named by the entries it holds. */
  directories(): ReadonlyMap<string, Digest>;
  /**
   * The configuration digest: these header lines, then the tree's own part.
   *
   * `aliasesUnknown` folds in every path, which is what `reuse.ts` falls back to
   * when no configuration bounds where a bare specifier could land.
   */
  configDigest(
    header: readonly string[],
    names: readonly string[],
    aliasesUnknown: boolean,
  ): Digest;
}

/**
 * The tree under `root`, natively when this checkout built the scanner.
 *
 * The JavaScript tree is not a fallback for the native one. It answers the one
 * question the native snapshot does not take — a caller that already knows
 * which paths `changed` (`variance ask --changed-file`) and wants only those
 * re-hashed instead of a whole `git status` — and it is the tree over digests
 * a caller supplies ({@link treeOf}).
 *
 * `undefined` for the same reason `gitDigests` returns it: this is not a
 * checkout, or git could not answer.
 */
export async function gitTreeOf(
  root: string,
  dirs?: readonly string[],
  changed?: readonly string[],
): Promise<Tree | undefined> {
  const addon = native();
  if (addon !== undefined && changed === undefined) {
    const held = dirs === undefined ? addon.gitTree(root) : addon.gitTreeFor(root, [...dirs]);
    if (held !== null) return nativeTree(held);
    return undefined;
  }

  const digests = await gitDigests(root, changed);

  return digests === undefined ? undefined : treeOf(digests);
}

/** A tree over digests somebody else computed — a caller's own map, or the one `gitDigests` read. */
export function treeOf(digests: ReadonlyMap<string, Digest>): Tree {
  let sorted: readonly string[] | undefined;
  const paths = (): readonly string[] =>
    (sorted ??= [...digests.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));

  return {
    get size() {
      return digests.size;
    },
    get: (path) => digests.get(path),
    getAll: (paths) => paths.map((path) => digests.get(path)),
    paths,
    named: (names) => paths().filter((path) => isNamed(path, names)),
    directories: () => directoriesOf(paths()),
    configDigest: (header, names, aliasesUnknown) =>
      digestString(
        [
          ...header,
          ...paths()
            .filter((path) => isNamed(path, names))
            .map((path) => `${path} ${digests.get(path)}`),
          ...(aliasesUnknown ? ['aliases unknown', ...paths()] : []),
        ].join('\n'),
      ),
  };
}

function nativeTree(held: NativeGitTree): Tree {
  const seeds = held.seeds();
  return {
    native: held,
    seeds,
    get size() {
      return held.size;
    },
    get: (path) => held.digest(path) ?? undefined,
    getAll: (paths) => held.digestsFor([...paths]).map((digest) => digest || undefined),
    paths: () => held.paths(),
    named: (names) => held.named([...names]),
    directories: () => new Map(Object.entries(held.directories())),
    configDigest: (header, names, aliasesUnknown) =>
      held.configDigest([...header], [...names], aliasesUnknown),
  };
}

/**
 * Whether a path's name decides where other files resolve to.
 *
 * The `tsconfig*.json` half is a pattern rather than a list and is the same on
 * both sides of the boundary; the literal names come from the caller, because
 * [`reuse.ts`](./reuse.ts) owns that list.
 */
function isNamed(path: string, names: readonly string[]): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);

  return names.includes(name) || (name.startsWith('tsconfig') && name.endsWith('.json'));
}
