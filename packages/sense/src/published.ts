/**
 * The source index as published state: one step writes it, every reader reads it.
 *
 * A reader that scans is an update step in disguise, and a repository with four
 * readers pays for its diff four times — at a scope each reader chose for itself,
 * so each one also evicts the records the others kept. So the two jobs are two
 * functions. {@link updateSourceIndex} absorbs what moved into the checkout's
 * one index, over the whole checkout, and appends it as a layer. {@link
 * readPublishedSources} opens what was published and asks nothing of Git or the
 * disk beyond the index itself.
 *
 * A reader that finds nothing published is told apart by where it runs, and the
 * caller says where, because the caller's runner already decided it. In CI a
 * missing index is a pipeline that skipped a step, and building it there would
 * hide that the cache never arrived, so it refuses and names the step. On a
 * workstation it is the first run, and {@link publishedSources} builds it and
 * says so.
 */

// compass: variance-authority.reach.source-index

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { FileRecord, Uses } from '@variance-authority/core/relate';
import type { Digest } from '@variance-authority/core/format';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { ParseCache, ParseKey, Parsed } from './cache.js';
import { seedPaths } from './files.js';
import type { NativeGitTree } from './native.js';
import { assertLogPath } from './immutable-log.js';
import { realPath } from './resolve.js';
import { placesOf, stepped, type Progress } from './progress.js';
import { sourceIndexPath } from './source-index.js';
import { updateNatively } from './native-update.js';
import { parseStoresFor } from './parse-store.js';
import { markCheckout } from './test-selection/cache-layers.js';
import { openSourceIndexFile, type SourceIndexState } from './source-index-file.js';
import { SOURCE_INDEX_VERSION } from './source-index-format.js';
import { usesOf } from './uses.js';

/** One published generation, opened for reading. */
export interface PublishedSources {
  /** The index file that was read. */
  readonly path: string;
  /** Whether it was whole, absent, or readable only up to a bad segment or one of another format version. */
  readonly state: SourceIndexState;
  /** The format version the unread segment names, when `state` is `other-version`. */
  readonly written?: number;
  /** Every file the last update read, sorted by path compared by code unit. */
  readonly records: readonly FileRecord[];
  /**
   * What each file's bytes said, keyed as the scan keys it. A reader passes it
   * to `taintRecords` so an unchanged file is answered without being opened;
   * what a reader adds stays in memory and is never saved.
   */
  readonly cache: ParseCache;
  /** The segment digests that were read, in order: the generation's identity. */
  readonly generation: readonly Digest[];
  /**
   * How each file uses each file it imports, joined from the records and parses
   * above when a walk asks for an edge. Nothing is stored for it.
   */
  readonly uses: Uses;
}

/** Open the published generation at `path`. Reads the index and nothing else. */
export async function readPublishedSources(path: string): Promise<PublishedSources> {
  const file = await openSourceIndexFile(path);
  const stored = file.stored;
  const added = new Map<ParseKey, Parsed>();
  const cache: ParseCache = {
    get: (key) => added.get(key) ?? stored.parses.get(key),
    set: (key, parsed) => { added.set(key, parsed); },
    keep: () => {},
  };
  return {
    path,
    state: file.state,
    ...(file.written === undefined ? {} : { written: file.written }),
    records: [...stored.records.values()]
      .map((held) => held.record)
      .sort((left, right) => codeUnitOrder(left.file, right.file)),
    cache,
    generation: file.generation,
    uses: usesOf(stored.records, cache),
  };
}

/**
 * The records a scan seeded from `dirs` and `before` would have produced, taken
 * out of a generation scanned from the whole checkout.
 *
 * The same seeds the scan takes and the same walk over the edges it recorded, so
 * a reader with a narrower question gets the narrower graph without scanning.
 */
export function sourcesWithin(
  records: readonly FileRecord[],
  root: string,
  dirs: readonly string[],
  before: readonly string[] = [],
): readonly FileRecord[] {
  const byFile = new Map(records.map((record) => [record.file, record]));
  const queue = [...seedPaths(resolve(root), dirs, [...byFile.keys()]), ...before];
  const reached = new Set<string>();
  for (let head = 0; head < queue.length; head += 1) {
    const file = queue[head]!;
    const record = byFile.get(file);
    if (record === undefined || reached.has(file)) continue;
    reached.add(file);
    for (const edge of record.edges ?? []) queue.push(edge.to);
  }
  return records.filter((record) => reached.has(record.file));
}

export interface SourceUpdateOptions {
  /** The index to update. The checkout's own, from `sourceIndexPath`, when absent. */
  readonly index?: string;
  /** `false` reads each file's bytes from the working tree, as `scanRelations` takes it. */
  readonly packs?: boolean;
  /** Prepare the code map's Git metadata during a missing-index build. */
  readonly prepareMap?: boolean;
  /** Told each step as it starts and ends: the git listing, then the read of what changed. */
  readonly progress?: Progress;
  /**
   * The directories below `root` the index covers, as `scanRelations` takes
   * them: what they hold and what it reaches. The whole of `root` when absent.
   */
  readonly dirs?: readonly string[];
}

/** What one update read and what it published. */
export interface SourceUpdate {
  readonly path: string;
  /** The explicit working-tree read policy, carried to the index's follow-ups. */
  readonly packs?: false;
  /** What the index was before this update. */
  readonly was: SourceIndexState;
  /** The format version the index was written in, when `was` is `other-version`. */
  readonly written?: number;
  /**
   * What the file system refused when this update wrote the index. Present only
   * then: the counts describe the scan, and the index on disk is what it was.
   */
  readonly refused?: string;
  /** Files the published generation holds. */
  readonly files: number;
  /** Files whose record this update rebuilt, because the published one no longer described them. */
  readonly reread: number;
  /**
   * Modules this update parsed: the files it reread that neither its index nor
   * the cache's parse store answered.
   */
  readonly parsed: number;
  /**
   * When this update began, before it read anything of the checkout: what it
   * holds is the checkout at this time or later, so what is published from it
   * says this and not when it was published.
   */
  readonly readStartedAt: string;
  /**
   * The native listing used by this update, for later steps such as the code
   * map to reuse. Includes filesystem listings outside Git.
   */
  readonly listing?: NativeGitTree;
}

/**
 * Absorb what moved in the checkout into its source index, as one appended layer.
 *
 * The scope is the index's, whoever asks: the whole checkout, or for an index a
 * workspace keeps over what its member list names, the `dirs` that list names.
 * A reader's question is narrower than that and is answered by filtering what
 * was published; an index whose scope followed its last caller would be right
 * for one reader at a time.
 */
export async function updateSourceIndex(
  root: string,
  options: SourceUpdateOptions = {},
): Promise<SourceUpdate> {
  const readStartedAt = new Date().toISOString();
  const where = resolve(root);
  const path = options.index ?? sourceIndexPath(where);
  assertLogPath(path);
  const dirs = options.dirs ?? ['.'];
  const missing = !existsSync(path);
  const stores = await stepped(undefined, 'source parse-store policy', () =>
    dirname(path) === dirname(sourceIndexPath(where)) ? parseStoresFor(where) : undefined);
  const everything = `reading every file of ${placesOf(where, dirs)}, because there is no index to update`;
  const natively = await updateNatively(
    realPath(where), path, options.progress, dirs, stores, missing ? everything : undefined, options.packs, options.prepareMap === true && missing,
  );
  if (natively === undefined) throw new Error(`sense: native source indexing could not update ${path}`);
  if (options.index === undefined) markCheckout(realPath(where));
  return {
    path,
    ...(options.packs === false ? { packs: false as const } : {}),
    was: natively.was,
    ...(natively.written === undefined ? {} : { written: natively.written }),
    ...(natively.refused === undefined ? {} : { refused: natively.refused }),
    files: natively.files,
    reread: natively.reread,
    parsed: natively.parsed,
    readStartedAt,
    ...(natively.listing === undefined ? {} : { listing: natively.listing }),
  };
}

/** The refusal a reader gives in CI when the index it reads was never published. */
export class SourceIndexUnpublished extends Error {
  override readonly name = 'SourceIndexUnpublished';
}

export interface PublishedSourcesOptions {
  /** Whether this runs in CI, as the caller's own runner decided it. */
  readonly ci: boolean;
  /** The command that publishes the index, named in the refusal and the notice. */
  readonly step: string;
  /** Told, in one line, when this builds an index nobody published. */
  readonly announce: (line: string) => void;
  /** The index to read. The checkout's own when absent. */
  readonly index?: string;
  /** How a local update reads bytes, as {@link SourceUpdateOptions} takes it. */
  readonly packs?: boolean;
}

/**
 * The published generation, or the reason there is none.
 *
 * Whole: returned as read. Missing, damaged, or written in another format
 * version in CI: refused, naming the step the pipeline lacks. Any of them
 * anywhere else: updated once — from the valid prefix, when there is one — with
 * a line saying which of them it was, then read.
 */
export async function publishedSources(
  root: string,
  options: PublishedSourcesOptions,
): Promise<PublishedSources> {
  return publishedThrough(root, options, readPublishedSources);
}

/**
 * What `read` answers of the published generation, under {@link publishedSources}'
 * policy: whole, returned as read; anything else refused in CI and updated once
 * elsewhere, then read again.
 */
export async function publishedThrough<Read extends { readonly state: SourceIndexState; readonly written?: number }>(
  root: string,
  options: PublishedSourcesOptions,
  read: (path: string) => Promise<Read>,
): Promise<Read> {
  const path = options.index ?? sourceIndexPath(resolve(root));
  const first = await read(path);
  if (first.state === 'published') return first;

  const what = first.state === 'missing'
    ? `no source index is published at ${path}`
    : first.state === 'other-version'
      ? `the source index at ${path} was written in format version ${String(first.written)}, ` +
        `and this release reads version ${String(SOURCE_INDEX_VERSION)}`
      : `the source index at ${path} is damaged, and reads only up to its first bad segment`;
  if (options.ci) {
    throw new SourceIndexUnpublished(first.state === 'other-version'
      ? `${what}. In CI the index is a step of the pipeline: run \`${options.step}\` with this release before this command.`
      : `${what}. In CI the index is a step of the pipeline: restore the cache that holds it, ` +
        `then run \`${options.step}\` before this command.`);
  }
  const doing = first.state === 'other-version' ? 'rebuilding' : 'updating';
  options.announce(`${what}; ${doing} it from the checkout, which is what \`${options.step}\` does.`);
  await updateSourceIndex(root, {
    index: path,
    ...(options.packs === undefined ? {} : { packs: options.packs }),
  });
  return read(path);
}
