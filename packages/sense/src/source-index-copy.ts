/**
 * A source index carried to another machine as the bytes the addon wrote.
 *
 * A release that changes the index's format makes every checkout read every
 * file again, and in a large repository that is minutes. CI has already paid
 * it for the mainline, so a checkout that opted in takes CI's index whole and
 * the update that follows reads only the files that differ from it: the addon
 * updates a chain it can open by each file's blob, whichever machine wrote it.
 *
 * Nothing here composes a manifest. The publisher carries the manifest and the
 * segments as they are on disk, and the restore places them where they were:
 * every segment by its digest first, the manifest last, as the addon's own
 * writer commits a chain (`native/src/log.rs`).
 */

// compass: variance-authority.reach.source-index

import { open, readFile, rm } from 'node:fs/promises';
import type { Digest } from '@variance-authority/core/format';
import { SegmentCutShort } from '@variance-authority/core/segment';
import { digestBytes } from './digest.js';
import { decodeManifest, segmentPath, type SegmentReference } from './immutable-log.js';
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
 * segment's header and nothing past it.
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

/**
 * Place the chain `manifest` names at `path`, each segment's bytes from `read`,
 * over an index another release wrote. False, and the index left as it was,
 * when a segment is not what its digest says or not this release's format, or
 * when the index at `path` was written in this release's format meanwhile.
 */
export async function restoreSourceIndex(
  path: string,
  manifest: Uint8Array,
  read: (digest: Digest) => Promise<Uint8Array | undefined>,
): Promise<boolean> {
  const segments = manifestOf(Buffer.from(manifest));
  if (segments === undefined || segments.length === 0) return false;
  const placed: string[] = [];
  for (const { digest, length } of segments) {
    const file = segmentPath(path, digest);
    const bytes = await read(digest);
    if (bytes === undefined || bytes.length !== length || digestBytes(bytes) !== digest) return false;
    if (versionOf(bytes) !== SOURCE_INDEX_VERSION) return false;
    await writeCoverageBytes(file, bytes);
    placed.push(file);
  }
  // An update that rebuilt the index while the segments came is newer than CI's; it stands.
  if (await sourceIndexWrittenIn(path) === SOURCE_INDEX_VERSION) return false;
  const replaced = await sourceIndexChain(path);
  await writeCoverageBytes(path, manifest);
  const kept = new Set(placed);
  await Promise.all((replaced?.segments ?? [])
    .filter((segment) => !kept.has(segment.path))
    .map((segment) => rm(segment.path, { force: true })));
  return true;
}

function manifestOf(bytes: Buffer): readonly SegmentReference[] | undefined {
  try {
    return decodeManifest(bytes);
  } catch {
    return undefined;
  }
}

function versionOf(bytes: Uint8Array): number | undefined {
  try {
    return sourceIndexVersionOf(bytes);
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
