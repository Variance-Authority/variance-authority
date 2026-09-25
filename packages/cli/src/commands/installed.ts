/**
 * What is installed, and what a diff did to it.
 *
 * The far-right end of the line a selection walks. A run starts at the test
 * harness, moves right through the tests into the repository's own files, and
 * goes out past them into the dependencies — and it never comes back: nothing
 * in `node_modules` imports anything of ours. So the package layer is read
 * once, joined to the file graph by name, and walked backwards like everything
 * else.
 *
 * ## Why the lockfile is a source and never a changed path
 *
 * A changed `yarn.lock` is not evidence of anything. A workspace version bump
 * rewrites it and installs nothing; a `resolutions` edit rewrites half of it
 * and moves one package; a lint of the file rewrites all of it and moves none.
 * Taken as a changed file it forces a whole run on every `yarn add` — which is
 * the single most expensive widening a real repository hits.
 *
 * Read at two revisions instead, it answers the only question worth asking:
 * **which package names resolved to something different**. That is a diff of
 * data, not of text, and a workspace-only churn produces an empty one.
 *
 * `package.json` goes the same way, for a different reason, and only as far as
 * that reason reaches. Its dependency ranges are a request, not a result — a
 * resolver, a `resolutions` block, a patch protocol, an override each turn the
 * same range into a different install — and the lockfile is where that request
 * was answered. Its `exports`, `main` or `type` are answered nowhere in the
 * lockfile: they decide which file every importer of the package loads. So each
 * changed manifest is read at both revisions too, and the ones whose change
 * reaches past the install's fields are carried as `moved`, for the walk to
 * treat their package as a changed directory. The rest are dropped from the
 * changed list: counted again as unknown changed paths, they would widen the
 * run for exactly the thing that was just measured exactly.
 *
 * ## Names, not instances
 *
 * Everything here collapses to package names. Two copies of `jsdom` at two
 * versions are one node, and a bump of either is a bump of `jsdom`. That is not
 * a simplification of the data: source code asks for a *name*, and which
 * instance a resolver handed a given importer is unanswerable without
 * reproducing that resolver — pnpm's store, Yarn PnP and npm's hoisting each
 * answer it differently, and none of them writes the answer down per importer.
 * Collapsing over-includes, which is the direction a selector is allowed to
 * be wrong in.
 */

// compass: variance-authority.reach

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { nodesOfKind, within, type Relations } from '@variance-authority/core/relate';

/** A package name each importing file gets an edge to, and the package it rests on. */
export type Depends = readonly (readonly [string, string])[];

/**
 * The `package → package` edges of the install here, for the graph to join.
 *
 * Empty for every reason that is not an install: no lockfile, no scanner, a
 * format this cannot read. None of those is a silent narrowing, and the pairing
 * is what makes that true — the same unreadable lockfile that costs these edges
 * also refuses the *diff* below, and a run that cannot compare its install does
 * not narrow at all.
 */
export async function installedDepends(from: string): Promise<Depends> {
  const found = await lockfileNear(from);
  if (found === undefined) return [];

  try {
    const lock = await import('@variance-authority/sense/lock');
    return lock.packageRelations(lock.readLockfile(found.file, found.text));
  } catch {
    return [];
  }
}

/** A checkout, and the commit a diff in it is measured from. */
export interface DiffPoint {
  readonly repository: string;
  readonly base: string;
  /** One file's contents at that commit, or `undefined` when it was not there. */
  at(path: string): Promise<string | undefined>;
}

/**
 * Which packages this diff installed differently, or the reason it cannot say.
 *
 * `undefined` is *there is no install to compare* — no lockfile anywhere above
 * the run, or no revision to compare it against — and it is the one absence
 * that widens nothing: a repository with no recorded install has no diff of
 * one, so no seed is missing. Every other failure is a sentence, because *this
 * cannot be read* and *nothing changed* produce the same empty list and mean
 * opposite things.
 *
 * The point is passed in rather than resolved here, and that is the join that
 * has to hold: the file list is measured from the merge base, and an install
 * read at any other commit would report bumps nobody made every time `main`
 * moved.
 *
 * The comparison short-circuits on bytes. Two identical lockfiles resolved
 * identically, whatever format they are in and whether or not this can read it
 * — which is why a `pnpm-lock.yaml` from a version this refuses costs nothing
 * on any run that did not touch it.
 *
 * `changed` is the diff's own file list, relative to `from`, and the manifests
 * among it are the only ones read: git has already said which moved.
 */
export async function installDiff(
  point: DiffPoint | undefined,
  changed: readonly string[],
  from: string = process.cwd(),
): Promise<InstallDiff | undefined> {
  const found = await lockfileNear(from);
  if (found === undefined || point === undefined) return undefined;

  const path = relative(point.repository, found.file);
  // A lockfile above the checkout is somebody else's install — a vendored
  // subject inside a larger tree — and `git show` cannot name it. Nothing is
  // compared and nothing is claimed.
  if (path.startsWith('..')) return undefined;

  const manifests = [pathTail(found.file), MANIFEST];
  const moved = await movedManifests(changed, (file) => {
    const at = resolve(from, file);
    const named = relative(point.repository, at);
    return Promise.all([
      named.startsWith('..') ? undefined : point.at(named),
      readFile(at, 'utf8').catch(() => undefined),
    ]);
  });
  const before = await point.at(path);
  if (before === found.text) return { packages: [], manifests, moved };

  if (before === undefined) {
    return {
      whole:
        `${path} is not in the tree at the base of this diff, so there is no install to compare ` +
        'it against and any package in it may have moved',
    };
  }

  return await compared(path, before, found.text, manifests, moved);
}

/**
 * Which packages a patch installed differently, read off the patch itself.
 *
 * A patch handed in is not a diff this run measured, so neither end of it is
 * the working tree: a replayed commit's lockfile is somewhere in history. The
 * patch already names both ends — `index <before>..<after>` is git's name for
 * each blob — so git is asked for them by that name rather than anything being
 * reconstructed from the hunks. An after-blob git does not hold is an edit
 * nobody committed, and it is the working tree's file when that file hashes to
 * the same name.
 *
 * `undefined` when the patch leaves every lockfile alone. A lockfile the patch
 * changes and git cannot produce at both ends is a sentence, for the reason
 * {@link installDiff} gives one.
 */
export async function installDiffOfPatch(patch: string, root: string = process.cwd()): Promise<InstallDiff | undefined> {
  const names = await import('@variance-authority/sense/lock')
    .then((lock) => lock.LOCKFILES as readonly string[])
    .catch(() => undefined);
  if (names === undefined) return undefined;

  const found = entriesIn(patch, (path) => names.includes(pathTail(path)))[0];
  if (found === undefined) return undefined;
  const manifests = [pathTail(found.path), MANIFEST];
  if (found.before === undefined || found.after === undefined) {
    return {
      whole:
        `${found.path} changed in this patch and the patch carries no \`index\` line naming its ` +
        'blobs, so there is no install to compare. Hand in the output of `git diff` itself',
    };
  }
  const { path, before: from, after: to } = found;
  const [before, after] = await Promise.all([
    blob(from, root),
    blob(to, root).then((text) => text ?? worktree(path, to, root)),
  ]);
  if (before === undefined || after === undefined) {
    const missing = before === undefined ? from : to;
    return {
      whole:
        `${found.path} changed in this patch and blob ${missing} is not in this repository, so ` +
        'there is no install to compare it against and any package in it may have moved',
    };
  }
  // Every manifest the patch names, read by the same blob names. One with no
  // `index` line has no ends to read, and is a move.
  const blobs = new Map(entriesIn(patch, (path) => pathTail(path) === MANIFEST).map((entry) => [entry.path, entry]));
  const moved = await movedManifests([...blobs.keys()], async (file) => {
    const entry = blobs.get(file)!;
    if (!entry.indexed) return [undefined, undefined];
    return await Promise.all([
      entry.before === undefined ? undefined : blob(entry.before, root),
      entry.after === undefined
        ? undefined
        : blob(entry.after, root).then((text) => text ?? worktree(file, entry.after!, root)),
    ]);
  });
  return await compared(found.path, before, after, manifests, moved);
}

/**
 * The changed manifests whose change reaches past what the install reads.
 *
 * Both ends come from the caller, which is the one that knows where each
 * revision lives — a commit and the working tree, or two blobs a patch names —
 * and `manifestMoved` in the lockfile reader owns which fields the install
 * speaks for, so this and the repository's own `yarn test:since` cannot
 * disagree about it. No reader is no reading: every changed manifest moved.
 */
async function movedManifests(
  changed: readonly string[],
  ends: (file: string) => Promise<readonly [string | undefined, string | undefined]>,
): Promise<readonly string[]> {
  const candidates = changed.filter((file) => pathTail(file) === MANIFEST);
  if (candidates.length === 0) return [];
  const moves = await import('@variance-authority/sense/lock')
    .then((lock) => lock.manifestMoved)
    .catch(() => () => true);
  const moved: string[] = [];
  for (const file of candidates) {
    const [before, after] = await ends(file);
    if (moves(before, after)) moved.push(file);
  }
  return moved;
}

async function compared(
  path: string,
  before: string,
  after: string,
  manifests: readonly string[],
  moved: readonly string[],
): Promise<InstallDiff> {
  try {
    const lock = await import('@variance-authority/sense/lock');
    return {
      manifests,
      packages: lock.changedPackages(lock.readLockfile(path, before), lock.readLockfile(path, after)),
      moved,
    };
  } catch (error) {
    return {
      whole:
        `${path} changed and this could not read it: ${messageOf(error)}. A dependency bump is ` +
        'invisible without it, so the run observes everything rather than reporting success ' +
        'over a package it never compared',
    };
  }
}

/** A file a patch changes, and the blob names its `index` line gives each end. */
interface PatchEntry {
  readonly path: string;
  /** Whether an `index` line named the blobs at all; an absent end is an all-zero name. */
  readonly indexed: boolean;
  readonly before?: string;
  readonly after?: string;
}

/** Every file a patch changes whose path `wanted` accepts, in patch order. */
function entriesIn(patch: string, wanted: (path: string) => boolean): readonly PatchEntry[] {
  const found: PatchEntry[] = [];
  const lines = patch.split('\n');
  for (let at = 0; at < lines.length; at += 1) {
    const header = /^diff --git a\/(.+) b\/(.+)$/u.exec(lines[at]!);
    if (header === null || !wanted(header[2]!)) continue;
    let entry: PatchEntry = { path: header[2]!, indexed: false };
    for (let next = at + 1; next < lines.length && !lines[next]!.startsWith('diff --git '); next += 1) {
      const index = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/u.exec(lines[next]!);
      if (index === null) continue;
      const absent = (id: string) => /^0+$/u.test(id);
      entry = {
        path: header[2]!,
        indexed: true,
        ...(absent(index[1]!) ? {} : { before: index[1]! }),
        ...(absent(index[2]!) ? {} : { after: index[2]! }),
      };
      break;
    }
    found.push(entry);
  }
  return found;
}

/**
 * The text each file had before `patch`, read from the blob its `index` line
 * names. A file the patch names no old blob for — new, or written without
 * `index` lines — or whose blob is not in this repository has no entry.
 */
export async function patchPreimages(patch: string, root: string = process.cwd()): Promise<ReadonlyMap<string, string>> {
  const entries = entriesIn(patch, () => true).filter((entry) => entry.before !== undefined);
  const texts = await Promise.all(entries.map(async (entry) => [entry.path, await blob(entry.before!, root)] as const));
  return new Map(texts.filter((pair): pair is readonly [string, string] => pair[1] !== undefined));
}

async function blob(id: string, root: string): Promise<string | undefined> {
  try {
    const { stdout } = await promisify(execFile)('git', ['cat-file', 'blob', id], {
      cwd: root,
      maxBuffer: 256 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return undefined;
  }
}

async function worktree(path: string, id: string, root: string): Promise<string | undefined> {
  try {
    const { stdout } = await promisify(execFile)('git', ['hash-object', '--', path], { cwd: root });
    return stdout.trim().startsWith(id) ? await readFile(join(root, path), 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The nearest lockfile at or above a directory, with its contents.
 *
 * Upwards because the install is the repository's, not the package's: a run
 * started inside `packages/ui` of a monorepo is installed by the lockfile at
 * the top, and looking only beside the run would find nothing and quietly
 * conclude that no package can ever change.
 *
 * The names come from the reader that will parse them, so a format added there
 * is found here without a second list to keep in step. No reader is no
 * lockfile: a checkout with no scanner installed has no file graph either, and
 * a manifest in its diff is an ordinary unreadable changed path again.
 */
async function lockfileNear(
  from: string,
): Promise<{ readonly file: string; readonly text: string } | undefined> {
  const names = await import('@variance-authority/sense/lock')
    .then((lock) => lock.LOCKFILES)
    .catch(() => undefined);
  if (names === undefined) return undefined;

  let at = from;

  for (;;) {
    for (const name of names) {
      const file = join(at, name);
      const text = await readFile(file, 'utf8').catch(() => undefined);
      if (text !== undefined) return { file, text };
    }

    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
}

const MANIFEST = 'package.json';

function pathTail(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a diff did to the install — the far-right end of the same line.
 *
 * A read of the lockfile at both revisions, collapsed to package names, or the
 * sentence saying the comparison could not be made. Never a list of changed
 * lockfile paths: which bytes of a lockfile changed says nothing (a workspace
 * version bump rewrites it and installs nothing), and which package names
 * resolved differently says everything.
 *
 * `manifests` are the *file names* that comparison speaks for — the lockfile's
 * own, and `package.json`, whose dependency fields are a request the lockfile
 * answered. A walk drops them from its seeds; anything else in the diff is
 * still a changed file.
 *
 * `moved` are the changed `package.json` *paths* whose change reaches past
 * those fields — `exports`, `main`, `type`, `name` — read at both revisions by
 * the same comparison. Each one's directory is a changed directory: every
 * importer of the package may now load a different file.
 */
export type InstallDiff =
  | {
      readonly packages: readonly string[];
      readonly manifests: readonly string[];
      readonly moved: readonly string[];
    }
  | { readonly whole: string };

/** The install as *nothing happened*, for a caller that has no reading to offer. */
export const NO_INSTALL_DIFF: InstallDiff = { packages: [], manifests: [], moved: [] };

/**
 * Paths the install comparison has already spoken for, or handed on as `moved`.
 *
 * Matched on the last segment, so a monorepo's every `package.json` goes the
 * same way the root one does: a resolver, a `resolutions` block, a version
 * range — the install answered all three, at both revisions, by name. A moved
 * manifest is dropped here too; {@link movedPackages} says what stands in for it.
 */
export function withoutManifests(
  changed: readonly string[],
  manifests: readonly string[],
): readonly string[] {
  return changed.filter(
    (file) => !manifests.some((name) => file === name || file.endsWith(`/${name}`)),
  );
}

/**
 * The files of every package whose manifest moved, from the graph.
 *
 * The directory of a moved `package.json` is expanded the way a monorepo tool's
 * changed directory is: every file the graph holds under it. A moved manifest
 * the graph holds no file beside is returned in `unplaced`, to be read as the
 * ordinary changed path it would have been — a gap under the scanned roots, a
 * file nothing reads outside them — rather than as a package that reached
 * nothing.
 */
export function movedPackages(
  relations: Relations,
  install: InstallDiff | undefined,
): { readonly files: readonly string[]; readonly unplaced: readonly string[] } {
  const moved = install === undefined || 'whole' in install ? [] : install.moved;
  if (moved.length === 0) return { files: [], unplaced: [] };
  const names = nodesOfKind(relations, 'file').map((id) => relations.names[id]!);
  const files = new Set<string>();
  const unplaced: string[] = [];
  for (const manifest of moved) {
    const beside = names.filter((file) => within(file, [directoryOf(manifest)]));
    if (beside.length === 0) unplaced.push(manifest);
    for (const file of beside) files.add(file);
  }
  return { files: [...files].sort(byCodeUnit), unplaced };
}

/**
 * A patch that also changes, whole, every file of a package whose manifest
 * moved — the journal's reading of {@link movedPackages}.
 *
 * A file named with no hunk is every recorded region of it, and a file with no
 * row is answered by its recorded importers, so a package whose `exports`
 * moved selects every test that entered it or anything importing it, which is
 * what the walk's changed directory selects.
 */
export function withMovedPackages(diff: string, files: readonly string[]): string {
  if (files.length === 0) return diff;
  return [diff, ...files.map((file) => `diff --git a/${file} b/${file}`)].join('\n');
}

function directoryOf(file: string): string {
  const at = file.lastIndexOf('/');
  return at === -1 ? '.' : file.slice(0, at);
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
