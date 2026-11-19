// compass: variance-authority.reach
/**
 * The source index CI built, carried beside the mainline's record, for a
 * repository that opted in with `share.sourceIndex`.
 *
 * A release that changes the index's format makes the next update on every
 * checkout read every file, and in a large repository that is minutes. CI pays
 * it once on the mainline anyway, so `share --suite` publishes that index on
 * the mainline as one more entry, its segments cut into pieces that are the
 * entry's images. The share stores an image once, so a commit sends only the
 * pieces no commit before it sent: the segments its update wrote. An update
 * over an index another release wrote, with no other checkout of this release
 * to start from, fetches it as it starts, places it beside its own, starts from
 * it as it starts from another checkout's, and reads only the files that
 * differ; the mainline's record never waits on it. Nothing is fetched for an
 * index this release wrote: the update it already has is the cheaper read.
 *
 * The checkout that bumps `variance` before CI has published an index in the
 * new format finds none, and reads every file, as it does without the setting.
 */

import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { ShareEntry } from '@variance-authority/core/share';
import type { SourceFetch } from '@variance-authority/sense';
import { sourceIndexEntry } from '../share-entries.js';

/**
 * The most bytes one image of the index holds. A segment is carried as pieces
 * of this length, each an image named by its digest: Node reads no file past
 * 2 GiB whole and a git host refuses a blob past 100 MB, and a piece the share
 * already holds, at this commit or at any other, is not sent again.
 */
export const SOURCE_INDEX_PIECE = 32 * 2 ** 20;

/** The entry's bytes: the chain's manifest, and each segment it names, by its digest, as the digests of its pieces in order. */
interface CarriedIndex {
  readonly manifest: string;
  readonly segments: Readonly<Record<string, readonly string[]>>;
}

/** Where a piece is read from when the share asks for it. */
interface Piece {
  readonly file: string;
  readonly offset: number;
  readonly length: number;
}

/** The entry this release's index is published and fetched under. */
async function sourceIndexEntryName(): Promise<string> {
  const { SOURCE_INDEX_VERSION } = await import('@variance-authority/sense');
  return sourceIndexEntry(SOURCE_INDEX_VERSION);
}

/**
 * The index at `root` as an entry at `commit`, and its pieces by image digest;
 * or why it is not published. `piece` is the most bytes one image holds.
 */
export async function sourceIndexEntryOf(
  root: string,
  at: { readonly commit: string; readonly head?: string },
  piece = SOURCE_INDEX_PIECE,
): Promise<{ readonly entry: ShareEntry; readonly image: (digest: string) => Promise<Uint8Array> } | { readonly unpublished: string }> {
  const sense = await import('@variance-authority/sense');
  const path = sense.sourceIndexPath(root);
  const chain = await sense.sourceIndexChain(path);
  const written = chain === undefined ? undefined : await sense.sourceIndexWrittenIn(path);
  if (chain === undefined || written === undefined) return { unpublished: `this checkout has no source index at ${path} that reads` };
  if (written !== sense.SOURCE_INDEX_VERSION) {
    return { unpublished: `the source index at ${path} was written in format version ${String(written)}, and this release writes ${String(sense.SOURCE_INDEX_VERSION)}` };
  }
  // Digested here and read again when the share asks: it asks only for the pieces the share does not hold yet.
  // A piece is named as the share names an image, the whole SHA-256 in hex, which `entryDigest` gives from the
  // portable implementation: about 30 s over Firefox's 2 GB index, against about 2 s from `node:crypto` here.
  const pieces = new Map<string, Piece>();
  const segments: Record<string, string[]> = {};
  for (const segment of chain.segments) {
    const digests: string[] = [];
    await eachPiece(segment.path, piece, (bytes, offset) => {
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (!pieces.has(digest)) pieces.set(digest, { file: segment.path, offset, length: bytes.length });
      digests.push(digest);
    });
    segments[segment.digest] = digests;
  }
  const carried: CarriedIndex = { manifest: chain.manifest.toString('base64'), segments };
  const entry: ShareEntry = {
    name: await sourceIndexEntryName(),
    commit: at.commit,
    ...(at.head === undefined ? {} : { head: at.head }),
    images: [...pieces.keys()],
    bytes: Buffer.from(JSON.stringify(carried), 'utf8'),
  };
  return {
    entry,
    image: async (digest) => {
      const held = pieces.get(digest);
      if (held === undefined) throw new Error(`the source index names no piece ${digest}`);
      return readPiece(held);
    },
  };
}

/**
 * Place the index an entry's `bytes` carry at `into`, each piece from `image`.
 * False, with nothing placed, when the bytes are not such an entry, or a piece
 * is missing, or a segment is not what its digest says.
 */
export async function placeSourceIndexEntry(
  into: string,
  bytes: Uint8Array,
  image: (digest: string) => Promise<Uint8Array | undefined>,
): Promise<boolean> {
  const carried = carriedOf(bytes);
  if (carried === undefined) return false;
  const sense = await import('@variance-authority/sense');
  return sense.placeSourceIndex(into, Buffer.from(carried.manifest, 'base64'), (digest) => {
    const pieces = Object.hasOwn(carried.segments, digest) ? carried.segments[digest] : undefined;
    return pieces === undefined ? undefined : (async function* () {
      for (const piece of pieces) yield await image(piece);
    })();
  });
}

function carriedOf(bytes: Uint8Array): CarriedIndex | undefined {
  try {
    const carried = JSON.parse(Buffer.from(bytes).toString('utf8')) as Partial<CarriedIndex>;
    const pieces = (list: unknown): boolean => Array.isArray(list) && list.every((digest) => typeof digest === 'string');
    const segments = carried.segments;
    return typeof carried.manifest === 'string' && typeof segments === 'object' && segments !== null && Object.values(segments).every(pieces)
      ? (carried as CarriedIndex)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Each `piece` bytes of `file` in order, with the offset each starts at; one buffer, reused. */
async function eachPiece(file: string, piece: number, visit: (bytes: Uint8Array, offset: number) => void): Promise<void> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(piece);
    for (let offset = 0; ; ) {
      let filled = 0;
      while (filled < piece) {
        const { bytesRead } = await handle.read(buffer, filled, piece - filled, offset + filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      if (filled === 0) return;
      visit(buffer.subarray(0, filled), offset);
      if (filled < piece) return;
      offset += filled;
    }
  } finally {
    await handle.close();
  }
}

async function readPiece(held: Piece): Promise<Uint8Array> {
  const handle = await open(held.file, 'r');
  try {
    const bytes = Buffer.alloc(held.length);
    let filled = 0;
    while (filled < held.length) {
      const { bytesRead } = await handle.read(bytes, filled, held.length - filled, held.offset + filled);
      if (bytesRead === 0) throw new Error(`${held.file} ended at ${String(held.offset + filled)}, inside a piece it held when published`);
      filled += bytesRead;
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

/**
 * {@link SourceFetch}: places the mainline's index at `into` and says whose it
 * is. The update asks it only over an index another release wrote, as it
 * starts, so it runs while the checkout is listed, and a command that does not
 * update the index never starts it. Undefined, with nothing placed and git not
 * asked, when the repository did not opt in. An opted-in repository is told on
 * stderr that the download starts, and why nothing was placed when the share
 * holds no index in this release's format, cannot be read, or holds one that
 * does not check out against its digests.
 */
export const fetchFromMainline: SourceFetch = async (root, into) => {
  // Loaded here: every reader of the index imports this, and the update asks only over another release's.
  const { rootShare } = await import('./mainline-selected.js');
  const { cacheRootFor, rootConfig } = await import('@variance-authority/sense/test-selection');
  // The opt-in first: a repository that did not opt in asks git nothing, and a share section that does not parse opts in to nothing.
  let share: ReturnType<typeof rootShare>;
  try {
    share = rootShare(rootConfig(root));
  } catch {
    return undefined;
  }
  if (share?.sourceIndex !== true) return undefined;
  const missed = (why: string): undefined => {
    process.stderr.write(`variance: CI's source index was not fetched, so every file is read: ${why}\n`);
    return undefined;
  };
  try {
    const { readerMainline } = await import('../share-lines.js');
    const chosen = await readerMainline({ share }, process.env, root);
    const named = 'missing' in chosen ? undefined : chosen;
    const { mainlineEntry } = await import('./mainline-entry.js');
    const name = await sourceIndexEntryName();
    const found = await mainlineEntry({ share, cacheRoot: cacheRootFor(root) }, name, {
      env: process.env,
      cwd: root,
      ...(named === undefined ? {} : { mainline: named.name, ...(named.base === undefined ? {} : { base: named.base }) }),
    });
    if ('miss' in found) {
      return missed(`the share holds no ${name} (${'detail' in found.miss ? `${found.miss.kind}: ${found.miss.detail}` : found.miss.kind})`);
    }
    const whose = `${found.at.mainline}'s at ${found.at.commit.slice(0, 12)}`;
    process.stderr.write(`variance: fetching ${whose} source index, since this checkout's was written by another release\n`);
    const carried = await found.held.bytes();
    if (!(carried instanceof Uint8Array)) return missed(`the manifest of ${whose} did not read`);
    const images = new Set(found.held.entry.images ?? []);
    const placed = await placeSourceIndexEntry(into, carried, async (digest) => {
      if (!images.has(digest)) return undefined;
      const bytes = await found.held.image(digest);
      return bytes instanceof Uint8Array ? bytes : undefined;
    });
    return placed ? whose : missed(`a segment of ${whose} is missing or not what its digest says`);
  } catch (error) {
    return missed(error instanceof Error ? error.message : String(error));
  }
};
