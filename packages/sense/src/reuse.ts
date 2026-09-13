/**
 * A whole record — edges included — kept from the last run, and the one fact that
 * makes keeping it sound.
 *
 * [`cache.ts`](./cache.ts) remembers what a file's *bytes* said, which is
 * cacheable forever because it depends on nothing else. An **edge** is not: where
 * `./button.css` points depends on the directory the specifier sits in, on which
 * files exist around it, on `tsconfig` paths and on what is installed. So a scan
 * with a hot parse cache still opens no files and still spends all its time in the
 * resolver, asking the same questions about a repository that did not move.
 *
 * A record is a function of exactly four things:
 *
 * | | named by |
 * | --- | --- |
 * | the file's bytes | its content digest |
 * | where the file sits | its path, which is the key |
 * | how resolution is configured | the config digest |
 * | which paths could have answered it | its witnesses |
 *
 * The first two a scan already has. The config digest names the manifests, lock
 * files and `tsconfig` contents every resolution in the repository reads, so a
 * change to one of them rebuilds everything and says so. The witnesses name the
 * directories that particular file's specifiers looked in
 * ([`witness.ts`](./witness.ts)), so a change to one of *them* rebuilds the
 * records that were looking.
 *
 * ## What a path appearing costs
 *
 * The directory it appeared in, and nothing else. Adding a component under
 * `packages/panel/src` moves one directory, and the records rebuilt are the ones
 * whose specifiers name that directory — its neighbours, and whoever imports
 * into it. A repository taking a hundred pull requests an hour moves a hundred
 * directories an hour and keeps the rest of its index, which is the property the
 * previous rule did not have: it digested the whole path set, so one added file
 * invalidated every record in the repository.
 *
 * ## Where it gives up
 *
 * A bare specifier is bounded by the `paths` a `tsconfig` declares, and a
 * configuration that cannot be read is no bound at all. When
 * [`aliasesIn`](./witness.ts) comes back empty-handed the whole path set goes
 * into the config digest instead, which is the old rule, applied on purpose and
 * only where nothing better is available.
 *
 * ## What this does not cover
 *
 * Files git cannot see. The tree is built from the digest map, which comes from
 * the object database, so a generated file appearing under a `.gitignore` moves
 * no directory. Such a file can never appear in a diff and so can never carry a
 * change — but it can, in principle, shadow a resolution. That is the one gap, it
 * is bounded by `git add`, and `digests: false` turns the whole mechanism off.
 */

import { basename } from 'node:path';
import { digestString, type Digest } from './digest.js';
import type { FileRecord } from '@variance-authority/core/relate';
import { DEFAULT_CONDITIONS, type ResolveOptions } from './resolve.js';
import { openSourceIndexFile, type IndexedRecord } from './source-index-file.js';
import { aliasesIn, directoriesOf, movedDirectories, type Aliases } from './witness.js';

/** The tree as reuse sees it: one digest for the configuration, one per directory. */
export interface TreeShape {
  /** How resolution is configured, and — when aliases are unknown — every path. */
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
  /**
   * Remember a record and the directories that answered it.
   *
   * One without a digest is not remembered — see `save`.
   */
  set(record: FileRecord, witnesses: readonly string[]): void;
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

/** Bumped when `FileRecord` or the config inputs change, so record keys move. */
const VERSION = 2;

/**
 * Files whose *contents* decide where other files resolve to.
 *
 * A path list alone would miss an edit to `tsconfig.json` that redirects every
 * `@/` specifier in the repository, or a lockfile change that swaps which copy of
 * a package a bare specifier lands on.
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
  readonly options?: ResolveOptions;
}): Promise<{ readonly shape: TreeShape; readonly aliases: Aliases | undefined }> {
  const { root, digests, options } = input;
  const paths = [...digests.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const aliases = await aliasesIn(root, paths);

  const lines = [
    `version ${VERSION}`,
    `root ${root}`,
    `tsconfig ${options?.tsconfig ?? 'auto'}`,
    `conditions ${(options?.conditionNames ?? DEFAULT_CONDITIONS).join(',')}`,
    ...paths.filter(decidesConfig).map((path) => `${path} ${digests.get(path)}`),
    // No bound on where a bare specifier could land means no bound on what a new
    // path could change, and the honest expression of that is the old rule.
    ...(aliases === undefined ? ['aliases unknown', ...paths] : []),
  ];

  return {
    shape: { config: digestString(lines.join('\n')), directories: directoriesOf(paths) },
    aliases,
  };
}

function decidesConfig(path: string): boolean {
  const name = basename(path);

  return (
    LAYOUT_FILES.includes(name) || (name.startsWith('tsconfig') && name.endsWith('.json'))
  );
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
    get: (file, digest) => matching(entries.get(file), digest),
    set(record, witnesses) {
      if (record.digest !== undefined) entries.set(record.file, { record, witnesses });
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

      return found;
    },
    set(record, witnesses) {
      if (record.digest !== undefined) used.set(record.file, { record, witnesses });
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
 * A configuration move is everything. A directory move is the records that named
 * it — which is why the witnesses are stored beside the record rather than
 * recomputed here: the specifiers that produced them are in a parse the record
 * was built from, and a run that reuses the record never opens it.
 */
export function prune(
  entries: Map<string, IndexedRecord>,
  before: TreeShape | undefined,
  after: TreeShape,
): void {
  if (before === undefined || before.config !== after.config) {
    entries.clear();
    return;
  }

  const moved = movedDirectories(before.directories, after.directories);
  if (moved.size === 0) return;

  for (const [file, held] of entries) {
    if (held.witnesses.some((directory) => moved.has(directory))) entries.delete(file);
  }
}

/** A record only answers for the bytes it was built from. */
function matching(held: IndexedRecord | undefined, digest: Digest): FileRecord | undefined {
  return held?.record.digest === digest ? held.record : undefined;
}
