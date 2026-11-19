/**
 * A source index carried to another machine as the bytes the addon wrote.
 *
 * A release that changes the index's format makes every checkout read every
 * file again, and in a large repository that is minutes. CI has already paid
 * it for the mainline, so a checkout that opted in places CI's index beside its
 * own, and the update offers it to the addon to start from, as it offers another
 * checkout's: the addon reads only the files that differ from it and writes the
 * checkout's own index. Nothing here writes that index.
 *
 * Nothing here composes a manifest either. The publisher carries the manifest
 * and the segments as they are on disk, and the fetch places them as they were:
 * every segment by its digest first, the manifest last, as the addon's own
 * writer commits a chain (`native/src/log.rs`).
 */

// compass: variance-authority.reach.source-index

import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Digest } from '@variance-authority/core/format';
import { SegmentCutShort } from '@variance-authority/core/segment';
import { digestPieces } from './digest.js';
import { decodeManifest, segmentDirectory, segmentPath, type SegmentReference } from './immutable-log.js';
import { SOURCE_INDEX_VERSION, sourceIndexVersionOf } from './source-index-format.js';
import { writeCoverageBytes } from './test-selection/record-location.js';

/** A chain as it is on disk: the manifest's bytes, and each segment it names with the file that holds it. */
export interface SourceIndexChain {
  readonly manifest: Buffer;
  readonly segments: readonly { readonly digest: Digest; readonly path: string }[];
}

/** The chain whose manifest is at `path`, or undefined when there is none or it is not a manifest. */
export async function sourceIndexChain(path: string): Promise<SourceIndexChain | undefined> {
  const manifest = await readFile(path).catch(() => undefined);
  if (manifest === undefined) return undefined;
  const segments = manifestOf(manifest);
  return segments === undefined
    ? undefined
    : { manifest, segments: segments.map(({ digest }) => ({ digest, path: segmentPath(path, digest) })) };
}

/**
 * The format version the index at `path` was written in: this release's when
 * every segment names it, else the first other one a segment names. Undefined
 * when there is no index, or one that does not read that far. Reads each
 * segment's header and nothing past it: what an update asks before it fetches,
 * and what a publish asks before it carries the index, neither of which reads
 * the index itself.
 */
export async function sourceIndexWrittenIn(path: string): Promise<number | undefined> {
  const chain = await sourceIndexChain(path);
  if (chain === undefined || chain.segments.length === 0) return undefined;
  for (const segment of chain.segments) {
    const version = await headerVersion(segment.path);
    if (version !== SOURCE_INDEX_VERSION) return version;
  }
  return SOURCE_INDEX_VERSION;
}

/** Where an update over the index at `path` has a fetched index placed: beside it, read once and removed. */
export function fetchedSourceIndexPath(path: string): string {
  return `${path}.fetched`;
}

/**
 * Place the chain `manifest` names at `into`, each segment's bytes from `read`
 * in the pieces it carries them in, in order: a segment can be past what one
 * buffer holds, so none is held whole. False, with nothing left at `into`,
 * when a segment is missing, or a piece is, or the
 * bytes are not what its digest says. Whether the chain opens under this
 * release is the addon's to say.
 */
export async function placeSourceIndex(
  into: string,
  manifest: Uint8Array,
  read: (digest: Digest) => AsyncIterable<Uint8Array | undefined> | undefined,
): Promise<boolean> {
  const segments = manifestOf(Buffer.from(manifest));
  if (segments === undefined || segments.length === 0) return false;
  for (const { digest, length } of segments) {
    const pieces = read(digest);
    if (pieces === undefined || !(await placeSegment(segmentPath(into, digest), pieces, digest, length))) {
      await dropSourceIndex(into);
      return false;
    }
  }
  await writeCoverageBytes(into, manifest);
  return true;
}

/** One segment written from its pieces beside `file`, and moved there only once its length and digest are its own. */
async function placeSegment(
  file: string,
  pieces: AsyncIterable<Uint8Array | undefined>,
  digest: Digest,
  length: number,
): Promise<boolean> {
  await mkdir(dirname(file), { recursive: true });
  const part = `${file}.${String(process.pid)}-${randomUUID()}.part`;
  const handle = await open(part, 'w');
  const hash = digestPieces();
  let written = 0;
  let whole = true;
  try {
    for await (const piece of pieces) {
      if (piece === undefined || written + piece.length > length) {
        whole = false;
        break;
      }
      hash.update(piece);
      await handle.write(piece, 0, piece.length, written);
      written += piece.length;
    }
  } finally {
    await handle.close();
  }
  if (whole && written === length && hash.digest() === digest) {
    await rename(part, file);
    return true;
  }
  await rm(part, { force: true });
  return false;
}

/** Remove the chain at `path`, manifest and segments. */
export async function dropSourceIndex(path: string): Promise<void> {
  await rm(path, { force: true });
  await rm(segmentDirectory(path), { recursive: true, force: true });
}

function manifestOf(bytes: Buffer): readonly SegmentReference[] | undefined {
  try {
    return decodeManifest(bytes);
  } catch {
    return undefined;
  }
}

/** The version a segment file's header names, read a page at a time until the header is whole. */
async function headerVersion(file: string): Promise<number | undefined> {
  const handle = await open(file, 'r').catch(() => undefined);
  if (handle === undefined) return undefined;
  try {
    let length = 4096;
    for (;;) {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      try {
        return sourceIndexVersionOf(buffer.subarray(0, bytesRead));
      } catch (error) {
        if (!(error instanceof SegmentCutShort) || bytesRead < length || error.needed <= length) return undefined;
        length = error.needed;
      }
    }
  } finally {
    await handle.close();
  }
}
