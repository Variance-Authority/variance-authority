/**
 * Native source publication and the shared local/CI policy for typed readers.
 * Updates absorb checkout changes once; readers retain their native snapshot.
 */

// compass: variance-authority.reach.source-index

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { NativeGitTree } from './native.js';
import { assertLogPath } from './immutable-log.js';
import { realPath } from './resolve.js';
import { placesOf, stepped, type Progress } from './progress.js';
import { sourceIndexPath } from './source-index.js';
import { updateNatively } from './native-update.js';
import { parseStoresFor } from './parse-store.js';
import { markCheckout } from './test-selection/cache-layers.js';
import type { SourceIndexState } from './source-index-file.js';
import { SOURCE_INDEX_VERSION } from './source-index-format.js';

export interface SourceUpdateOptions {
  /** Authoritative scan-root-relative paths to refresh instead of asking Git status. */
  readonly changed?: readonly string[];
  /** The index to update. The checkout's own, from `sourceIndexPath`, when absent. */
  readonly index?: string;
  /** `false` reads each file's bytes from the working tree, as the native scanner takes it. */
  readonly packs?: boolean;
  /** Prepare the code map's Git metadata during a missing-index build. */
  readonly prepareMap?: boolean;
  /** Told each step as it starts and ends: the git listing, then the read of what changed. */
  readonly progress?: Progress;
  /**
   * The directories below `root` the index covers, as the native scanner takes
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
    realPath(where), path, options.progress, dirs, stores, missing ? everything : undefined, options.packs, options.prepareMap === true && missing, options.changed,
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
 * What `read` answers of the published generation, under the shared publication
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
