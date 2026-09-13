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
 * | which paths exist | the layout digest |
 * | how resolution is configured | the layout digest |
 *
 * The first two a scan already has. `layoutOf` names the other two in one digest,
 * and a record may be reused when both it and the file's own digest are unchanged.
 *
 * ## The coarseness, and what it is worth
 *
 * Adding, deleting or renaming *any* file moves the layout and every record in
 * the repository is rebuilt. That is not a well-priced trade — a repository
 * taking pull requests all day moves its layout all day, so the branch that
 * would benefit most from reuse is the branch that never gets it.
 *
 * What it costs is worth stating, because it is not what it looks like. A record
 * is rebuilt from the parse cache, which is keyed by content and survives a
 * layout move ([`cache.ts`](./cache.ts)), and resolution is answered from a memo
 * ([`resolve.ts`](./resolve.ts)). Rebuilding all twenty-seven thousand records
 * of a component library measured the same as reusing them. The cliff people hit
 * was the parse cache pruning itself on the runs that reused everything, and
 * that was a defect rather than this trade.
 *
 * So what remains is bounded and proportional to the repository rather than to
 * the diff — which is the property to remove, and removing it means invalidating
 * a resolution by the paths that could have answered it rather than by the tree
 * as a whole.
 *
 * ## What this does not cover
 *
 * Files git cannot see. The layout is built from the digest map, which comes from
 * the object database, so a generated file appearing under a `.gitignore` does not
 * move it. Such a file can never appear in a diff and so can never carry a change
 * — but it can, in principle, shadow a resolution. That is the one gap, it is
 * bounded by `git add`, and `digests: false` turns the whole mechanism off.
 */

import { basename } from 'node:path';
import { digestString, type Digest } from './digest.js';
import type { FileRecord } from '@variance-authority/core/relate';
import { DEFAULT_CONDITIONS, type ResolveOptions } from './resolve.js';
import { readSourceIndex, writeSourceIndex } from './source-index-file.js';

export interface RecordCache {
  /**
   * Adopt a tree shape, discarding everything remembered under another one.
   *
   * Called once per scan, before the first lookup. Every entry a cache holds was
   * built under some layout, and reading one under a different layout is reading
   * edges that were true of a repository this is not.
   */
  under(layout: Digest): void;
  /** The record last built for this file from these bytes, under this layout. */
  get(file: string, digest: Digest): FileRecord | undefined;
  /** Remember a record. One without a digest is not remembered — see `save`. */
  set(record: FileRecord): void;
}

export interface PersistentRecordCache extends RecordCache {
  /**
   * Write what this scan used back to disk, under the layout it adopted.
   *
   * Nothing is written when no layout was adopted, which is the case for a scan
   * with no digests: it reused nothing and validated nothing, and letting it save
   * would replace a usable cache with an empty one.
   */
  save(): Promise<void>;
}

/** Bumped when `FileRecord` or the layout inputs change, so record keys move. */
const VERSION = 1;

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
 * One digest naming which paths exist and how resolution is configured.
 *
 * The path *set* rather than a sample of it, because resolution is decided by
 * absence as much as presence: `./button` finds `button.ts` only while no
 * `button.tsx` sits beside it, and a barrel that stops re-exporting a deleted file
 * is a barrel whose edges moved without its own bytes moving.
 *
 * The scanned directories are deliberately *not* in here. They decide which
 * records a scan produces, never what any one record contains, so a narrower run
 * can reuse a wider run's work and neither invalidates the other.
 */
export function layoutOf(input: {
  readonly root: string;
  readonly digests: ReadonlyMap<string, Digest>;
  readonly options?: ResolveOptions;
}): Digest {
  const { root, digests, options } = input;

  const paths = [...digests.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lines = [
    `version ${VERSION}`,
    `root ${root}`,
    `tsconfig ${options?.tsconfig ?? 'auto'}`,
    `conditions ${(options?.conditionNames ?? DEFAULT_CONDITIONS).join(',')}`,
    ...paths.map((path) => (decidesLayout(path) ? `${path} ${digests.get(path)}` : path)),
  ];

  return digestString(lines.join('\n'));
}

function decidesLayout(path: string): boolean {
  const name = basename(path);

  return (
    LAYOUT_FILES.includes(name) || (name.startsWith('tsconfig') && name.endsWith('.json'))
  );
}

/** A cache that keeps everything and remembers nothing between processes. */
export function memoryRecordCache(): RecordCache {
  let adopted: Digest | undefined;
  const entries = new Map<string, FileRecord>();

  return {
    under(layout) {
      if (adopted !== layout) entries.clear();
      adopted = layout;
    },
    get: (file, digest) => matching(entries.get(file), digest),
    set(record) {
      if (record.digest !== undefined) entries.set(record.file, record);
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
  const generation = await readSourceIndex(path);
  const stored: Stored = { layout: generation.layout, entries: new Map(generation.records) };
  let adopted: Digest | undefined;
  const used = new Map<string, FileRecord>();

  return {
    under(layout) {
      adopted = layout;
      if (stored.layout !== layout) stored.entries.clear();
    },
    get(file, digest) {
      const record = matching(used.get(file) ?? stored.entries.get(file), digest);
      // Reading counts as using, exactly as it does for a parse. An unchanged
      // repository hits every entry and rewrites none of them.
      if (record !== undefined) used.set(file, record);

      return record;
    },
    set(record) {
      if (record.digest !== undefined) used.set(record.file, record);
    },
    async save() {
      if (adopted === undefined) return;

      await writeSourceIndex(path, { parses: generation.parses, layout: adopted, records: used });
    },
  };
}

/** A record only answers for the bytes it was built from. */
function matching(record: FileRecord | undefined, digest: Digest): FileRecord | undefined {
  return record?.digest === digest ? record : undefined;
}

interface Stored {
  readonly layout: Digest | undefined;
  readonly entries: Map<string, FileRecord>;
}
