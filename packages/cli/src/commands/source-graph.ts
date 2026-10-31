/**
 * What reads the tree: the component index, and the file graph over it.
 *
 * Kept out of [`resources.ts`](./resources.ts) by that file's own rule. The
 * things it resolves may not change a verdict — a store swapped for another
 * decides the same thing, a decoder is held to byte-identical RGBA, a cache in
 * the wrong place costs a re-render. These two can and do: without the graph the
 * selector falls back to declarations, and what a run *observes* changes. So the
 * environment is allowed a say over there and none at all here: both are read
 * by `sense`, a dependency imported like any other.
 */

import { existsSync, readdirSync, type Dirent } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { SourceIndex } from '@variance-authority/core/attribute';
import type { FileRecord, Relations } from '@variance-authority/core/relate';
import {
  publishedNames,
  publishedSources,
  runGraphOf,
  seedPaths,
  SourceIndexUnpublished,
  sourceIndexPath,
  sourcesWithin,
  taintFile,
  updateSourceIndex,
} from '@variance-authority/sense';
import { isCI } from 'ci-info';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';
import { indexOf } from './affected.js';
import { installedDepends } from './installed.js';

/**
 * The component index, from the directories the config names.
 *
 * The same walk the shipped collectors do, for the same reason: the module reader
 * in `sense` decides how a file becomes an index ([`indexOf`](./affected.ts)),
 * and this decides which files. Selection needs it *before* anything is
 * collected, so it cannot borrow the collector's.
 */
export async function scanSourceDirs(
  root: string,
  dirs: readonly string[],
): Promise<SourceIndex> {
  const contents = new Map<string, string>();
  for (const file of sourceFiles(root, dirs)) contents.set(relative(root, file), await readFile(file, 'utf8'));
  return indexOf(contents);
}

/**
 * The files `scanSourceDirs` reads, as absolute paths: whatever is on disk
 * under `dirs`, git-ignored or not, so a build identity can digest exactly the
 * bytes the scan saw.
 */
export function sourceFiles(root: string, dirs: readonly string[]): readonly string[] {
  return dirs.flatMap((dir) => walkSource(isAbsolute(dir) ? dir : join(root, dir)));
}

/**
 * The file graph, from the same directories the component index walks.
 *
 * The graph is read, never built here. One step publishes the checkout's
 * source index — `variance index` — and every reader reads that generation, so a
 * run that selects pays for the diff once, not once per reader. Where the index
 * is missing, CI refuses and names the step the pipeline lacks, and a
 * workstation builds it once and says so on stderr. CI is the runner's own
 * answer, read through `ci-info`, the package Jest asks.
 * `--no-git` changes where that local build reads each file's bytes — the
 * working tree rather than Git's object store — and nothing about what is read:
 * Git still names every file and its blob, so the index is the same one.
 *
 * The install is joined here too, and it is the same graph rather than a second
 * one. A file that imports `@mui/material` has an edge to a node named
 * `@mui/material`, the lockfile says which packages that one rests on, and a
 * transitive bump — `jsdom`, three levels under something a test imports —
 * reaches our code by the same backwards walk an edited file does
 * ([`installed.ts`](./installed.ts)).
 */
export async function relationsFor(...asked: Parameters<typeof sourceGraphFor>): Promise<Relations> {
  return (await sourceGraphFor(...asked)).relations;
}

/** The graph {@link relationsFor} reads, and the files the index read source in to build it: a node the graph holds is not one, since an import of a file nothing reads is a node too. */
export interface SourceGraph {
  readonly relations: Relations;
  readonly sources: ReadonlySet<string>;
  /** The name the index gives the text each file it holds holds now ({@link indexNames}). */
  readonly names: IndexNames;
}

/** The source index's name for the text each file it holds holds now: its git blob name. A file it does not hold has none. */
export type IndexNames = ReadonlyMap<string, string>;

/** The name `records`, the source index, gives the text each file it holds holds now; a file it holds no name for is in none. */
export function indexNames(records: readonly FileRecord[]): IndexNames {
  return new Map(records.flatMap((record) => record.digest === undefined ? [] : [[record.file, record.digest] as const]));
}

/**
 * Bring the source index at `root` up to the checkout, for a reader that names
 * the checkout's texts by it and so needs it to name the texts on disk now. In
 * CI too: a published index was published at some commit, and the checkout may
 * be another, so it is updated from where it stands and pays only for what
 * differs. One CI never published is not built here: the reader refuses it, as
 * every reader in CI does. The readers that only walk the graph read the index
 * as it stands. An update that cannot be made is said on stderr and never
 * refused: the index is read as it stands, and what it names is not the
 * checkout's. `packs` false reads no installed package, as `variance index
 * --no-git` does. The reason, or nothing when the index is up to the checkout.
 */
export async function indexUpToCheckout(root: string, ci = isCI, packs = true): Promise<string | undefined> {
  if (ci && !(await isPublished(root))) return undefined;
  const path = sourceIndexPath(resolve(root));
  let refused: string | undefined;
  try {
    refused = (await updateSourceIndex(root, packs ? {} : { packs: false })).refused;
  } catch (error) {
    refused = messageOf(error);
  }
  if (refused === undefined) return undefined;
  const reason = `the source index at ${path} could not be updated to the checkout: ${refused}`;
  process.stderr.write(`variance: ${reason}; reading it as it stands.\n`);
  return reason;
}

/** Whether CI published a whole source index at `root`, read off none of its rows. */
async function isPublished(root: string): Promise<boolean> {
  try {
    await publishedNames(root, [], { ci: true, step: 'variance index', announce: () => {} });
    return true;
  } catch (error) {
    if (error instanceof SourceIndexUnpublished) return false;
    throw error;
  }
}

/**
 * The source index's names for the texts `files` hold on disk now, read off its
 * rows of those files alone ({@link publishedNames}), brought up to the checkout
 * first ({@link indexUpToCheckout}); or why they have no names: the update
 * failed, or CI published no index. A file the index holds no name for is in
 * none.
 */
export async function checkoutNames(root: string, files: readonly string[], ci = isCI): Promise<IndexNames | { readonly missed: string }> {
  const notUpdated = await indexUpToCheckout(root, ci);
  if (notUpdated !== undefined) return { missed: notUpdated };
  try {
    return (await publishedNames(root, files, { ci, step: 'variance index', announce: (line) => process.stderr.write(`variance: ${line}\n`) })).names;
  } catch (error) {
    if (error instanceof SourceIndexUnpublished) return { missed: error.message };
    throw error;
  }
}

/**
 * {@link relationsFor}, with the files the source index read, from the one read
 * of it. `holding` names the files the caller's question is about, a diff's
 * changed files: a workstation's index that lacks one is brought up to the
 * checkout first ({@link indexUpToCheckout}).
 */
export async function sourceGraphFor(
  root: string,
  dirs: readonly string[],
  taints: readonly string[] = [],
  before: readonly string[] = [],
  noGit = false,
  holding: readonly string[] = [],
): Promise<SourceGraph> {
  const read = await publishedWithin(root, dirs, before, noGit, holding);

  // The mocks are read unasked, as every reader of the checkout's graph reads
  // them; a table named in the config is answered here too, and what it adds
  // is never saved.
  const tables = await Promise.all(taints.map((file) => taintFile(join(root, file))));

  // Read from the lockfile at this revision, never from `package.json`: a range
  // is a request and the lockfile is the answer to it. Empty when there is no
  // install to read, which loses the transitive half of a package bump and
  // never the direct half — and the diff that would have needed it refuses on
  // the same unreadable file rather than narrowing.
  const depends = await installedDepends(root);

  return {
    relations: await runGraphOf(read.records, { root, cache: read.cache, taints: tables, depends, uses: read.uses }),
    sources: new Set(read.records.map((record) => record.file)),
    names: indexNames(read.all),
  };
}

/**
 * The published records this caller's scope reaches.
 *
 * The index holds the whole checkout; the scope is the part a scan seeded from
 * `dirs` would have reached. The harness is seeded as exact paths: it lives
 * outside every directory anybody would point a component scan at, and what it
 * loads is the part of a run nothing imports and every test rests on.
 */
async function publishedWithin(
  root: string,
  dirs: readonly string[],
  before: readonly string[],
  noGit: boolean,
  holding: readonly string[],
) {
  if (!isCI) await upToHolding(root, holding, noGit);
  let published;
  try {
    published = await publishedSources(root, {
      ci: isCI,
      step: noGit ? 'variance index --no-git' : 'variance index',
      announce: (line) => process.stderr.write(`variance: ${line}\n`),
      ...(noGit ? { packs: false } : {}),
    });
  } catch (error) {
    // A pipeline without the step is the operator's to fix, and the refusal
    // already names the step; printed as a defect, it would send them to file
    // a bug instead.
    if (error instanceof SourceIndexUnpublished) throw new OperatorError(error.message, { cause: error });
    throw error;
  }
  return {
    records: sourcesWithin(published.records, root, dirs, before),
    all: published.records,
    cache: published.cache,
    uses: published.uses,
  };
}

/**
 * Bring a workstation's source index up to the checkout when it lacks one of
 * `holding` that the checkout holds and a scan reads, saying which on stderr:
 * a file added since the last `variance index` has no edges until it is read.
 */
async function upToHolding(root: string, holding: readonly string[], noGit: boolean): Promise<void> {
  if (holding.length === 0) return;
  const step = noGit ? 'variance index --no-git' : 'variance index';
  const announce = (line: string) => process.stderr.write(`variance: ${line}\n`);
  const { names } = await publishedNames(root, holding, { ci: false, step, announce });
  const where = resolve(root);
  const lacking = seedPaths(where, ['.'], holding.filter((file) => !names.has(file)))
    .find((file) => existsSync(join(where, file)));
  if (lacking === undefined) return;
  announce(`the source index at ${sourceIndexPath(where)} does not hold ${lacking}, which the checkout does; ` +
    `updating it from the checkout, which is what \`${step}\` does.`);
  await indexUpToCheckout(root, false, !noGit);
}

const SOURCE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js'];
const SOURCE_EXCLUDE = ['node_modules', '.test.', '.spec.', '.stories.', 'dist/'];

function walkSource(dir: string): readonly string[] {
  const found: string[] = [];

  let entries: readonly Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A configured directory that does not exist contributes nothing rather than
    // failing the run: the refusal that matters is an empty *index*, and the
    // selector states that itself.
    return found;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (SOURCE_EXCLUDE.some((skip) => path.includes(skip))) continue;
    if (entry.isDirectory()) found.push(...walkSource(path));
    else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }

  return found;
}
