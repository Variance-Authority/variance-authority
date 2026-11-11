/**
 * An atomic pointer to ordered immutable byte segments.
 *
 * The manifest is the commit: a segment written without it is unreachable, and
 * a manifest is published only after every segment it names exists. Every
 * prefix of a chain was itself a chain somebody could have read, so a segment
 * that cannot be used costs the segments from it onward and never the ones
 * before it — the reader keeps the prefix and says how much it dropped.
 *
 * This file reads. The writer is the addon's (`native/src/log.rs`), and it
 * is the only one: it decides what the next manifest names as well as writing
 * it — a save's or an update's layers become the working layer over the base
 * the chain was readied with (`native/src/append_index.rs`), and readying folds
 * that layer into the base before work (`native/src/ready_index.rs`).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digestBytes } from './digest.js';
import type { Digest } from '@variance-authority/core/format';

const MAGIC = Buffer.from('VAIDXLSM');
const VERSION = 1;
const HEADER_BYTES = MAGIC.length + 4;
/** How many manifests a reader follows while writers keep moving it, before it keeps the prefix it read as `moved`. */
const MOVED_ATTEMPTS = 8;

interface SegmentReference {
  readonly digest: Digest;
  readonly length: number;
}

interface Manifest {
  readonly format: 'variance-authority-immutable-log';
  readonly version: 1;
  readonly segments: readonly SegmentReference[];
}

export interface ImmutableLog {
  /** Where the manifest is: the path the chain was opened at. */
  readonly path: string;
  readonly segments: readonly Buffer[];
  /** The committed chain's segment digests, in order: the identity of what was read. */
  readonly digests: readonly Digest[];
  readonly legacy: boolean;
  readonly committed: boolean;
  /**
   * How many segments the manifest named past the last one read. Zero for a
   * whole chain; anything else means `segments` is an older generation than the
   * one that was published, and a reader that answers from it is answering late.
   */
  readonly dropped: number;
  /**
   * Whether the manifest moved under every read: `dropped` then counts segments
   * writers replaced, not damage. Only a manifest that held still while one of
   * its segments was missing is damaged.
   */
  readonly moved: boolean;
  /**
   * Segments lost to damage: `dropped`, less those a moved read lost to writers.
   * What `keep` cuts later, and a moved read that kept nothing, count in full.
   */
  readonly damaged: number;
  /** The same chain cut to its first `count` segments, for a caller that rejects one further on. */
  keep(count: number): ImmutableLog;
}

/**
 * Open the committed chain. Missing state is an empty chain and a malformed
 * manifest throws; a segment that is missing or fails its digest ends the chain
 * there, and `dropped` counts what it cost.
 */
export async function openImmutableLog(path: string): Promise<ImmutableLog> {
  named(path);
  for (let attempt = 1; ; attempt += 1) {
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if (!missing(error)) throw error;
      return logAt(path, [], [], false, false);
    }

    if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
      return logAt(path, [], [bytes], true, true);
    }

    const references = decodeManifest(bytes);
    const directory = segmentDirectory(path);
    const read = await Promise.all(references.map(async (reference) => {
      try {
        const segment = await readFile(join(directory, fileName(reference.digest)));
        return segment.length === reference.length && digestBytes(segment) === reference.digest
          ? segment
          : undefined;
      } catch {
        return undefined;
      }
    }));
    const valid = read.findIndex((segment) => segment === undefined);
    // A writer removes the segments its manifest stopped naming, so a segment
    // missing under a manifest that has since moved is a read that lost the
    // race, not a damaged chain.
    const raced = valid !== -1 && await moved(path, bytes);
    if (raced && attempt < MOVED_ATTEMPTS) continue;
    const count = valid === -1 ? read.length : valid;
    // Nothing left is no answer, late or not.
    const late = raced && count > 0 ? references.length - count : 0;
    return logAt(
      path,
      references.slice(0, count),
      read.slice(0, count) as Buffer[],
      false,
      true,
      references.length - count,
      late,
    );
  }
}

/** No chain at `path`: what a save writes over state that could not be opened. */
export function emptyImmutableLog(path: string): ImmutableLog {
  named(path);
  return logAt(path, [], [], false, false);
}

function logAt(
  path: string,
  references: readonly SegmentReference[],
  segments: readonly Buffer[],
  legacy: boolean,
  committed: boolean,
  dropped = 0,
  late = 0,
): ImmutableLog {
  return {
    path,
    segments,
    digests: references.map((reference) => reference.digest),
    legacy,
    committed,
    dropped,
    moved: late > 0,
    damaged: dropped - late,
    keep: (count) => count >= segments.length
      ? logAt(path, references, segments, legacy, committed, dropped, late)
      : logAt(
          path,
          references.slice(0, count),
          segments.slice(0, count),
          legacy,
          committed,
          dropped + segments.length - count,
          late,
        ),
  };
}

function decodeManifest(bytes: Buffer): readonly SegmentReference[] {
  if (bytes.length < HEADER_BYTES) throw new Error('invalid immutable log manifest');
  const length = bytes.readUInt32LE(MAGIC.length);
  if (length !== bytes.length - HEADER_BYTES) throw new Error('invalid immutable log manifest');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8', HEADER_BYTES));
  } catch { throw new Error('invalid immutable log manifest'); }
  if (!manifestIsValid(parsed)) throw new Error('invalid immutable log manifest');
  return parsed.segments;
}

function manifestIsValid(value: unknown): value is Manifest {
  if (typeof value !== 'object' || value === null) return false;
  const manifest = value as Partial<Manifest>;
  if (manifest.format !== 'variance-authority-immutable-log' ||
      manifest.version !== VERSION || !Array.isArray(manifest.segments)) return false;
  return manifest.segments.every((segment) =>
    typeof segment === 'object' && segment !== null &&
    typeof segment.digest === 'string' && /^v1:[0-9a-f]{32}$/.test(segment.digest) &&
    Number.isSafeInteger(segment.length) && segment.length >= 0);
}

/**
 * A path that cannot name a file, told apart from a cache that will not read.
 *
 * Its own class rather than a bare `TypeError`, because the reader that has to
 * tell the two apart reads corrupt bytes for a living: a truncated segment
 * decoded as a structure throws whatever the first wrong field throws, and a
 * `TypeError` among those is ordinary.
 */
export class BadLogPath extends TypeError {
  override readonly name = 'BadLogPath';
}

/**
 * The path is a string, checked rather than declared.
 *
 * The type is erased before this runs, and a path that cannot name a file
 * does not fail where it lands. An object reaches `readFile` as a `TypeError`,
 * which a reader of corrupt caches cannot tell from a miss. An empty string
 * reads as a missing chain, and the writer then makes `.segments` in the
 * caller's working directory before the manifest's rename refuses — orphaned
 * segments and a scan that reported nothing. So it is a caller's defect and
 * says so here, where the name is still recognisable, rather than as bytes
 * under a name nobody meant.
 */
function named(path: string): void {
  if (typeof path !== 'string' || path === '') {
    throw new BadLogPath(
      `immutable log path must be a non-empty string, received ${typeof path}`,
    );
  }
}

async function moved(path: string, read: Buffer): Promise<boolean> {
  try {
    return !(await readFile(path)).equals(read);
  } catch (error) {
    if (!missing(error)) throw error;
    return true;
  }
}

function segmentDirectory(path: string): string { return `${path}.segments`; }
function fileName(digest: Digest): string { return `${digest.replace(':', '-')}.bin`; }
function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT';
}
