/**
 * A whole record — edges included — kept from the last run, and what keeps it sound.
 *
 * An edge, unlike a parse ([`cache.ts`](./cache.ts)), depends on more than the
 * file's bytes, so a record is kept on four things: its content digest, its
 * path, the caller's resolver options ({@link configOf}), and its witnesses —
 * the directories its specifiers looked in ([`witness.ts`](./witness.ts)). A
 * configuration file is keyed like any other file, and a path appearing moves
 * only its own directory, so only the records that looked there are rebuilt.
 *
 * Files git cannot see move no directory: a generated file under `.gitignore`
 * can, in principle, shadow a resolution. `git add` bounds that, and
 * `digests: false` turns reuse off.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path';
import { digestString, type Digest } from '@variance-authority/core/format';
import type { FileRecord } from '@variance-authority/core/relate';
import type { NativeIndexGraph } from './native-index-graph.js';
import { DEFAULT_CONDITIONS, type ResolveOptions } from './resolve.js';
import { openSourceIndexFile } from './source-index-file.js';
import type { IndexedRecord } from './source-index-format.js';
import { isNamed, treeOf, type Tree } from './tree.js';
import { aliasesIn, movedDirectories, type Aliases } from './witness.js';

/**
 * What decides a record besides the files: how specifiers resolve, and the
 * size past which a file is declined. A declined record names the bytes it
 * declined, so a raised limit has to move the digest or it would keep them.
 */
export type ShapeOptions = ResolveOptions & { readonly largestFile?: number };

/** The tree as reuse sees it: one digest for the configuration, one per directory. */
export interface TreeShape {
  /** How the caller configured resolution: options, never a file's contents. */
  readonly config: Digest;
  /** Every directory in the tree, named by the entries it holds. */
  readonly directories: ReadonlyMap<string, Digest>;
}

export interface RecordCache {
  /**
   * Adopt a tree, discarding what the move from the last one invalidated.
   *
   * Called once per scan, before the first lookup. A record built under another
   * configuration is edges that were true of a repository this is not; a record
   * whose witnesses moved is edges that may be.
   */
  under(shape: TreeShape): void;
  /** The record last built for this file from these bytes, still answerable. */
  get(file: string, digest: Digest): FileRecord | undefined;
  /** The same hit with resolution metadata for an indexed consumer. */
  getIndexed(file: string, digest: Digest): IndexedRecord | undefined;
  /**
   * Remember a record and the directories that answered it.
   *
   * Every record is held, and only one with a digest is ever handed back: a
   * record the scan could not read — a read that failed, a language with no
   * reader — is still the scan's answer for that file, and a reader of what was
   * saved must find it `unknown` rather than not find it. Without a digest it
   * names no bytes, so the next scan builds it again. A file declined past the
   * size cap names the bytes it declined when Git named them, and is kept.
   */
  set(record: FileRecord, witnesses: readonly string[], targets?: readonly (string | undefined)[]): void;
  /**
   * Remember every record a cold closure holds, as `set` would one at a time.
   *
   * Optional, because holding the closure is only a saving for a cache that
   * publishes it without asking for the records back. A cache without it is
   * handed each record through `set` instead, which is the scan it always had.
   */
  adopt?(graph: NativeIndexGraph): void;
}

export interface PersistentRecordCache extends RecordCache {
  /**
   * Write what this scan used back to disk, under the tree it adopted.
   *
   * Nothing is written when no tree was adopted, which is the case for a scan
   * with no digests: it reused nothing and validated nothing, and letting it save
   * would replace a usable cache with an empty one.
   */
  save(): Promise<void>;
}

/** Bumped when what a `FileRecord` holds or the config inputs change, so record keys move. */
const VERSION = 13;

/**
 * Files whose contents configure where other files resolve to. Not part of any
 * record's key (see the header): `review-drift` asks which edits are these.
 */
const LAYOUT_FILES = [
  'package.json',
  'jsconfig.json',
  'yarn.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'bun.lockb',
  'deno.json',
];

/** Whether a file's contents decide where other files' imports resolve: a manifest, a lockfile, a workspace or `tsconfig*.json`. */
export function decidesResolution(path: string): boolean {
  return isNamed(path, LAYOUT_FILES);
}

/**
 * The tree as two questions: how resolution is configured, and what each
 * directory holds.
 *
 * The scanned directories are deliberately in neither. They decide which records
 * a scan produces, never what any one record contains, so a narrower run can
 * reuse a wider run's work and neither invalidates the other.
 */
export async function treeShapeOf(input: {
  readonly root: string;
  readonly digests: ReadonlyMap<string, Digest>;
  readonly options?: ShapeOptions;
}): Promise<{ readonly shape: TreeShape; readonly aliases: Aliases | undefined }> {
  const { digests, ...rest } = input;

  return shapeOf({ ...rest, tree: treeOf(digests) });
}

/**
 * The same two questions, asked of a tree rather than of a map.
 *
 * Every line below is a fold over the repository's paths, and on a tree the size
 * of a monorepo the folding is the cost — so it is the tree that folds, and the
 * listing stays wherever it already is ([`tree.ts`](./tree.ts)).
 */
export async function shapeOf(input: {
  readonly root: string;
  readonly tree: Tree;
  readonly options?: ShapeOptions;
}): Promise<{ readonly shape: TreeShape; readonly aliases: Aliases | undefined }> {
  const { config, aliases } = await configOf(input);
  return { shape: { config, directories: input.tree.directories() }, aliases };
}

/**
 * The shape a scan of a directory git cannot list keeps its records under.
 * Nothing names a file's bytes before it is read there, so no record is reused
 * and the shape need only differ from every listed one: a scan git lists
 * clears the records kept under it, as it would another configuration's.
 */
export async function unlistedShapeOf(input: { readonly root: string; readonly options?: ShapeOptions }): Promise<TreeShape> {
  const { config } = await configOf({ ...input, tree: treeOf(new Map()) });
  return { config: digestString(`not listed by git\n${config}`), directories: new Map() };
}

/**
 * How the digest names a `tsconfig` setting: `auto`, `off`, or the file from the
 * checkout's root, so a worktree laid out alike adopts the primary checkout's
 * records. Its path, not its contents: the file is configuration like any other.
 */
function tsconfigNamed(root: string, tsconfig: string | false | undefined): string {
  if (tsconfig === undefined || tsconfig === 'auto') return 'auto';
  if (tsconfig === false) return 'off';
  const file = isAbsolute(tsconfig) ? tsconfig : resolve(root, tsconfig);
  return `file ${relative(root, file).split(sep).join('/')}`;
}

/**
 * The configuration half of {@link shapeOf}: the digest and the aliases,
 * without the directory digests, which the addon's update derives from its own
 * listing and a caller that hands it only the digest would build for nothing.
 *
 * The digest names what the caller decides and no file's contents. A
 * configuration edit reaches other files with the edits that come with it: a
 * new `paths` entry or `exports` subpath arrives with the files refactored to
 * use it, a moved target is a moved file, a new package is new files imported
 * by edited files, and a dependency bump moves no workspace answer. A mapping
 * edited alone, to redirect code nobody edited, is not followed; nor is a
 * mapping in a `tsconfig` that cannot be read, which declares nothing.
 */
export async function configOf(input: {
  readonly root: string;
  readonly tree: Tree;
  readonly options?: ShapeOptions;
}): Promise<{ readonly config: Digest; readonly aliases: Aliases | undefined }> {
  const { root, tree, options } = input;
  // The aliases bound which directories a bare specifier's record witnesses;
  // they are no part of the digest.
  const aliases = await aliasesIn(root, tree.named(['jsconfig.json']));

  // No `root`: a record names files relative to the checkout it was scanned
  // from and holds no absolute path, so a worktree adopts the primary
  // checkout's records wherever the two are laid out alike.
  const header = [
    `version ${VERSION}`,
    `tsconfig ${tsconfigNamed(root, options?.tsconfig)}`,
    // Unnamed conditions add each governing `tsconfig`'s `customConditions`;
    // named ones are the whole set.
    options?.conditionNames === undefined
      ? `conditions ${DEFAULT_CONDITIONS.join(',')} + tsconfig customConditions`
      : `conditions ${options.conditionNames.join(',')}`,
    // Named only when a caller names it, so every run at the default keeps
    // the digest it had before a limit was part of it.
    ...(options?.largestFile === undefined ? [] : [`largest ${options.largestFile}`]),
  ];

  return { config: digestString(header.join('\n')), aliases };
}

/** A cache that keeps everything and remembers nothing between processes. */
export function memoryRecordCache(): RecordCache {
  let adopted: TreeShape | undefined;
  const entries = new Map<string, IndexedRecord>();

  return {
    under(shape) {
      prune(entries, adopted, shape);
      adopted = shape;
    },
    get: (file, digest) => matching(entries.get(file), digest)?.record,
    getIndexed: (file, digest) => matching(entries.get(file), digest),
    set(record, witnesses, targets) {
      entries.set(record.file, { record, witnesses, ...(targets === undefined ? {} : { targets }) });
    },
  };
}

/**
 * The cache at `path`, loaded if it is there and usable.
 *
 * Every failure is silent and produces an empty cache, for the same reason
 * [`openParseCache`](./cache.ts) does: the cost of every one of them is a full
 * scan, which is what would have happened without a cache at all.
 */
export async function openRecordCache(path: string): Promise<PersistentRecordCache> {
  const file = await openSourceIndexFile(path);
  const generation = file.stored;
  const entries = new Map(generation.records);
  const held: TreeShape | undefined = generation.config === undefined
    ? undefined
    : { config: generation.config, directories: generation.directories };
  let adopted: TreeShape | undefined;
  const used = new Map<string, IndexedRecord>();

  return {
    under(shape) {
      adopted = shape;
      prune(entries, held, shape);
    },
    get(file, digest) {
      const held = used.get(file) ?? entries.get(file);
      const found = matching(held, digest);
      // Reading counts as using, exactly as it does for a parse. An unchanged
      // repository hits every entry and rewrites none of them.
      if (found !== undefined) used.set(file, held!);

      return found?.record;
    },
    getIndexed(file, digest) {
      const held = used.get(file) ?? entries.get(file);
      const found = matching(held, digest);
      if (found !== undefined) used.set(file, found);
      return found;
    },
    set(record, witnesses, targets) {
      used.set(record.file, { record, witnesses, ...(targets === undefined ? {} : { targets }) });
    },
    async save() {
      if (adopted === undefined) return;

      await file.save({
        parses: generation.parses,
        config: adopted.config,
        directories: adopted.directories,
        records: used,
      });
    },
  };
}

/**
 * Drop what the move from one tree to another could have changed.
 *
 * A configuration move — another version or other resolver options — is everything. A directory move is the records that named
 * it — which is why the witnesses are stored beside the record rather than
 * recomputed here: the specifiers that produced them are in a parse the record
 * was built from, and a run that reuses the record never opens it.
 *
 * The result says whether the adopted shape moved, so a persistent generation
 * can distinguish an unchanged scan from one that must publish new identity.
 */
export function prune(
  entries: Map<string, IndexedRecord>,
  before: TreeShape | undefined,
  after: TreeShape,
): boolean {
  if (before === undefined || before.config !== after.config) {
    entries.clear();
    return true;
  }

  const moved = movedDirectories(before.directories, after.directories);
  if (moved.size === 0) return false;

  for (const [file, held] of entries) {
    if (held.witnesses.some((directory) => moved.has(directory))) entries.delete(file);
  }
  return true;
}

/** A record only answers for the bytes it was built from. */
function matching(held: IndexedRecord | undefined, digest: Digest): IndexedRecord | undefined {
  return held?.record.digest === digest ? held : undefined;
}
