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
 *
 * A segment is carried in pieces of {@link SOURCE_INDEX_PIECE} bytes, each
 * named by its whole SHA-256 as a share names an image: a share stores an image
 * once, so a commit sends only the pieces of the segments its update wrote, and
 * no segment is too large for one image, nor for Node to read whole.
 */

// compass: variance-authority.reach.source-index

import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Digest } from '@variance-authority/core/format';
import { digestPieces, sha256Hex } from './digest.js';
import { decodeManifest, segmentDirectory, segmentPath, type SegmentReference } from './immutable-log.js';
import { SOURCE_INDEX_VERSION } from './source-index-format.js';
import { segmentVersionAt } from './source-index-reader.js';
import { writeCoverageBytes } from './test-selection/record-location.js';

/**
 * The most bytes one piece holds: Node reads no file past 2 GiB whole, a git
 * host refuses a blob past 100 MB, and a piece any commit already sent is not
 * sent again.
 */
export const SOURCE_INDEX_PIECE = 32 * 2 ** 20;

/**
 * A chain as it is on disk: where its manifest is, the manifest's bytes, and
 * each segment it names with its length and the file that holds it.
 */
export interface SourceIndexChain {
  readonly path: string;
  readonly manifest: Buffer;
  readonly segments: readonly { readonly digest: Digest; readonly length: number; readonly path: string }[];
}

/** The chain whose manifest is at `path`, or undefined when there is none or it is not a manifest. */
export async function sourceIndexChain(path: string): Promise<SourceIndexChain | undefined> {
  const manifest = await readFile(path).catch(() => undefined);
  if (manifest === undefined) return undefined;
  const segments = manifestOf(manifest);
  return segments === undefined
    ? undefined
    : { path, manifest, segments: segments.map(({ digest, length }) => ({ digest, length, path: segmentPath(path, digest) })) };
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
    const version = segmentVersionAt(segment.path);
    if (version !== SOURCE_INDEX_VERSION) return version;
  }
  return SOURCE_INDEX_VERSION;
}

/**
 * Where one update over the index at `path` has a fetched index placed: beside
 * it, read once and removed. Every call names another place, so a fetch an
 * update dropped unawaited, and removes whenever it ends, never meets the next
 * update's.
 */
export function fetchedSourceIndexPath(path: string): string {
  return join(fetchedDirectory(path), `${String(process.pid)}-${randomUUID()}.bin`);
}

function fetchedDirectory(path: string): string {
  return `${path}.fetched`;
}

/**
 * Remove what the fetches of an ended process left beside the index at `path`:
 * a process that exits while a dropped fetch still waits on the remote never
 * removes its place. A live process's place, this one's included, is its own.
 */
export async function sweepFetchedSourceIndexes(path: string): Promise<void> {
  const directory = fetchedDirectory(path);
  const names = await readdir(directory).catch(() => [] as string[]);
  for (const name of names) {
    const pid = Number(/^(\d+)-/.exec(name)?.[1]);
    if (Number.isSafeInteger(pid) && pid > 0 && !alive(pid)) await rm(join(directory, name), { recursive: true, force: true });
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Refused is a process this user may not signal: it runs.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** A carried chain's bytes, every piece they name once, and the bytes of one piece, read again from its segment when asked. */
export interface CarriedSourceIndex {
  readonly bytes: Uint8Array;
  readonly pieces: readonly string[];
  readonly piece: (name: string) => Promise<Uint8Array>;
}

/**
 * `chain` as it is carried: its manifest and each segment's pieces by name, in
 * order. None is held: `piece` reads one again when asked, so a share that
 * holds most of them reads only the rest. `size` is the most bytes one piece
 * holds.
 *
 * A segment never changes under its digest, so the names of its pieces are
 * kept beside the chain once hashed, and a carry hashes only the segments no
 * carry before it hashed: the update that wrote them is the cost, not the
 * size of the index. A kept list that does not read is hashed again.
 */
export async function carriedSourceIndex(chain: SourceIndexChain, size = SOURCE_INDEX_PIECE): Promise<CarriedSourceIndex> {
  const kept = await keptPieces(chain.path, size);
  const held = new Map<string, Piece>();
  const segments: Record<string, string[]> = {};
  let hashed = false;
  for (const segment of chain.segments) {
    const known = kept.get(segment.digest);
    const names: string[] = [];
    if (known !== undefined && known.length === Math.ceil(segment.length / size)) {
      known.forEach((name, at) => {
        const offset = at * size;
        if (!held.has(name)) held.set(name, { file: segment.path, offset, length: Math.min(size, segment.length - offset) });
        names.push(name);
      });
    } else {
      hashed = true;
      await eachPiece(segment.path, size, (bytes, offset) => {
        const name = sha256Hex(bytes);
        if (!held.has(name)) held.set(name, { file: segment.path, offset, length: bytes.length });
        names.push(name);
      });
    }
    segments[segment.digest] = names;
  }
  // Kept for the chain as it is now: a segment it no longer names is not kept, and a list that is not written is hashed again next time.
  if (hashed || kept.size !== chain.segments.length) {
    const pieces: KeptPieces = { size, segments };
    await writeCoverageBytes(piecesPath(chain.path), Buffer.from(JSON.stringify(pieces), 'utf8')).catch(() => undefined);
  }
  const carried: Carried = { manifest: chain.manifest.toString('base64'), segments };
  return {
    bytes: Buffer.from(JSON.stringify(carried), 'utf8'),
    pieces: [...held.keys()],
    piece: async (name) => {
      const at = held.get(name);
      if (at === undefined) throw new Error(`the source index names no piece ${name}`);
      return readPiece(at);
    },
  };
}

/**
 * Place the chain `bytes` carry, as {@link carriedSourceIndex} gives them, at
 * `into`, each piece from `piece`, in order: a segment can be past what one
 * buffer holds, so none is held whole. False, with nothing left at `into`, when
 * the bytes carry no chain, a segment or a piece is missing, or a segment is not
 * what its digest says. Whether the chain opens under this release is the
 * addon's to say.
 */
export async function placeSourceIndex(
  into: string,
  bytes: Uint8Array,
  piece: (name: string) => Promise<Uint8Array | undefined>,
): Promise<boolean> {
  const carried = carriedOf(bytes);
  const manifest = carried === undefined ? undefined : Buffer.from(carried.manifest, 'base64');
  const segments = manifest === undefined ? undefined : manifestOf(manifest);
  if (carried === undefined || manifest === undefined || segments === undefined || segments.length === 0) return false;
  for (const { digest, length } of segments) {
    const names = Object.hasOwn(carried.segments, digest) ? carried.segments[digest] : undefined;
    const pieces = names === undefined ? undefined : (async function* () {
      for (const name of names) yield await piece(name);
    })();
    if (pieces === undefined || !(await placeSegment(segmentPath(into, digest), pieces, digest, length))) {
      await dropSourceIndex(into);
      return false;
    }
  }
  await writeCoverageBytes(into, manifest);
  return true;
}

/** A chain's carried bytes: its manifest, and each segment it names, by its digest, as the names of its pieces in order. */
interface Carried {
  readonly manifest: string;
  readonly segments: Readonly<Record<string, readonly string[]>>;
}

/** Where a piece is read from when it is asked for. */
interface Piece {
  readonly file: string;
  readonly offset: number;
  readonly length: number;
}

/** The names of each segment's pieces, by its digest, as a carry of `size`-byte pieces last hashed them. */
interface KeptPieces {
  readonly size: number;
  readonly segments: Readonly<Record<string, readonly string[]>>;
}

function piecesPath(path: string): string {
  return `${path}.pieces`;
}

/** What a carry before this one kept of the chain at `path` in `size`-byte pieces: nothing when it kept none, of another size, or what does not read. */
async function keptPieces(path: string, size: number): Promise<ReadonlyMap<string, readonly string[]>> {
  try {
    const kept = JSON.parse(await readFile(piecesPath(path), 'utf8')) as Partial<KeptPieces>;
    const segments = kept.segments;
    if (kept.size !== size || typeof segments !== 'object' || segments === null) return new Map();
    const named = (list: unknown): list is string[] =>
      Array.isArray(list) && list.every((name) => typeof name === 'string' && /^[0-9a-f]{64}$/.test(name));
    return new Map(Object.entries(segments).filter((entry): entry is [string, string[]] => named(entry[1])));
  } catch {
    return new Map();
  }
}

function carriedOf(bytes: Uint8Array): Carried | undefined {
  try {
    const carried = JSON.parse(Buffer.from(bytes).toString('utf8')) as Partial<Carried>;
    const names = (list: unknown): boolean => Array.isArray(list) && list.every((name) => typeof name === 'string');
    const segments = carried.segments;
    return typeof carried.manifest === 'string' && typeof segments === 'object' && segments !== null && Object.values(segments).every(names)
      ? (carried as Carried)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Each `size` bytes of `file` in order, with the offset each starts at; one buffer, reused. */
async function eachPiece(file: string, size: number, visit: (bytes: Uint8Array, offset: number) => void): Promise<void> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(size);
    for (let offset = 0; ; ) {
      let filled = 0;
      while (filled < size) {
        const { bytesRead } = await handle.read(buffer, filled, size - filled, offset + filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      if (filled === 0) return;
      visit(buffer.subarray(0, filled), offset);
      if (filled < size) return;
      offset += filled;
    }
  } finally {
    await handle.close();
  }
}

async function readPiece(at: Piece): Promise<Uint8Array> {
  const handle = await open(at.file, 'r');
  try {
    const bytes = Buffer.alloc(at.length);
    let filled = 0;
    while (filled < at.length) {
      const { bytesRead } = await handle.read(bytes, filled, at.length - filled, at.offset + filled);
      if (bytesRead === 0) throw new Error(`${at.file} ended at ${String(at.offset + filled)}, inside a piece it held when published`);
      filled += bytesRead;
    }
    return bytes;
  } finally {
    await handle.close();
  }
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
      // A write may take fewer bytes than it was handed: the rest is written from where it stopped.
      for (let taken = 0; taken < piece.length; ) {
        const { bytesWritten } = await handle.write(piece, taken, piece.length - taken, written);
        taken += bytesWritten;
        written += bytesWritten;
      }
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

/** Remove the chain at `path`, manifest and segments, and what a carry kept of its pieces. */
export async function dropSourceIndex(path: string): Promise<void> {
  await rm(path, { force: true });
  await rm(piecesPath(path), { force: true });
  await rm(segmentDirectory(path), { recursive: true, force: true });
}

function manifestOf(bytes: Buffer): readonly SegmentReference[] | undefined {
  try {
    return decodeManifest(bytes);
  } catch {
    return undefined;
  }
}

