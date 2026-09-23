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

import { resolve } from 'node:path';
import type { FileRecord } from '@variance-authority/core/relate';
import type { Digest } from '@variance-authority/core/format';
import type { ParseCache, ParseKey, Parsed } from './cache.js';
import { seedPaths } from './files.js';
import { seedImmutableLog } from './immutable-log.js';
import type { RecordCache } from './reuse.js';
import { scanRelations } from './scan.js';
import { openSourceIndex, primarySourceIndexPath, sourceIndexPath } from './source-index.js';
import { openSourceIndexFile, type SourceIndexState } from './source-index-file.js';
import { taintRecords } from './taint/index.js';
import { mockTaint } from './taint/mocks.js';

/** One published generation, opened for reading. */
export interface PublishedSources {
  /** The index file that was read. */
  readonly path: string;
  /** Whether it was whole, absent, or readable only up to a bad segment. */
  readonly state: SourceIndexState;
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
    records: [...stored.records.values()]
      .map((held) => held.record)
      .sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0),
    cache,
    generation: file.generation,
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
}

/** What one update read and what it published. */
export interface SourceUpdate {
  readonly path: string;
  /** What the index was before this update. */
  readonly was: SourceIndexState;
  /** Files the published generation holds. */
  readonly files: number;
  /** Files whose record this update rebuilt, because the published one no longer described them. */
  readonly reread: number;
  /**
   * The primary checkout's index this one started from, when this checkout is a
   * worktree that had none of its own.
   */
  readonly from?: string;
}

/**
 * Absorb what moved in the checkout into its source index, as one appended layer.
 *
 * The scope is the whole checkout, whoever asks. A reader's question is narrower
 * than that and is answered by filtering what was published; an index whose
 * scope followed its last caller would be right for one reader at a time.
 *
 * The mock reader's answers are published beside the records, because every
 * selection asks them and a reader that has to compute one opens the file.
 */
export async function updateSourceIndex(
  root: string,
  options: SourceUpdateOptions = {},
): Promise<SourceUpdate> {
  const where = resolve(root);
  const path = options.index ?? sourceIndexPath(where);
  const was = (await openSourceIndexFile(path)).state;
  // A worktree's first update starts from the primary checkout's generation and
  // pays only for what differs between the two checkouts.
  const primary = options.index === undefined && was === 'missing'
    ? primarySourceIndexPath(where)
    : undefined;
  const from = primary !== undefined && await seedImmutableLog(path, primary) ? primary : undefined;
  const source = await openSourceIndex(path);
  // Counted on the record cache, not the parse cache: a cold scan attaches its
  // native parse layer to the parse cache object itself, and a wrapper there
  // would publish without it.
  const reused = new Set<string>();
  const reuse: RecordCache = {
    under: (shape) => source.reuse.under(shape),
    get: (file, digest) => {
      const found = source.reuse.get(file, digest);
      if (found !== undefined) reused.add(file);
      return found;
    },
    getIndexed: (file, digest) => {
      const found = source.reuse.getIndexed(file, digest);
      if (found !== undefined) reused.add(file);
      return found;
    },
    set: (record, witnesses, targets) => source.reuse.set(record, witnesses, targets),
  };
  const records = await scanRelations({
    root: where,
    dirs: ['.'],
    cache: source.cache,
    reuse,
    ...(options.packs === undefined ? {} : { packs: options.packs }),
  });
  await taintRecords(records, [mockTaint()], { root: where, cache: source.cache });
  await source.save();
  return {
    path,
    was,
    files: records.length,
    reread: records.length - reused.size,
    ...(from === undefined ? {} : { from }),
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
 * Whole: returned as read. Missing or damaged in CI: refused, naming the step
 * the pipeline lacks. Missing or damaged anywhere else: updated once — from the
 * valid prefix, when there is one — with a line saying so, then read.
 */
export async function publishedSources(
  root: string,
  options: PublishedSourcesOptions,
): Promise<PublishedSources> {
  const path = options.index ?? sourceIndexPath(resolve(root));
  const read = await readPublishedSources(path);
  if (read.state === 'published') return read;

  const what = read.state === 'missing'
    ? `no source index is published at ${path}`
    : `the source index at ${path} is damaged, and reads only up to its first bad segment`;
  if (options.ci) {
    throw new SourceIndexUnpublished(
      `${what}. In CI the index is a step of the pipeline: restore the cache that holds it, ` +
      `then run \`${options.step}\` before this command.`,
    );
  }
  options.announce(`${what}; updating it from the checkout, which is what \`${options.step}\` does.`);
  await updateSourceIndex(root, {
    index: path,
    ...(options.packs === undefined ? {} : { packs: options.packs }),
  });
  return readPublishedSources(path);
}
