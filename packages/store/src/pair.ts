// compass: variance-authority.retention

import { readFile, rm, rmdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Raster } from '@variance-authority/core/format';
import { REFUSAL, RasterStoreError, messageOf, sidecarFrom } from '@variance-authority/raster';
import { orAbsent } from './absent.js';
import { placedForIn, type PlacedFor } from './claims.js';
import { refuseAPointerRecord } from './lfs-pointer.js';

/**
 * One baseline on disk: an image and the record of what painted it, read and
 * removed as a pair.
 *
 * Split from `durable.ts`, which decides *which* pair a lookup reads; this file
 * decides what a pair on disk *is*, and refuses one that is half there. Every
 * lookup the durable store makes — a baseline, a description, a cached render —
 * reads through it, because each owes the same answer about a pair with one half
 * missing, and two copies of that answer are two chances to disagree.
 */

/** How a baseline's image becomes bytes. See `DurableStoreOptions.readImage`. */
export type ImageReader = (path: string) => Promise<Buffer>;

/**
 * Where the two halves of one baseline go.
 *
 * Equal prefixes unless `DurableStoreOptions.recordRoot` is set, which is
 * why the split costs a reader nothing to ignore: every path `durable.ts` reads comes
 * from one call, and the default makes both fields the string the file used to
 * pass around.
 */
export interface Places {
  /** The image's path, without the extension. */
  readonly image: string;
  /** The `.json`'s path, without the extension. */
  readonly record: string;
}

/**
 * A record as read, with who it was placed for beside it rather than inside:
 * `placedFor` says where a file-backed store filed the baseline, and nothing
 * downstream of the store reads it.
 */
export type Read<T> = T & { readonly placedFor?: PlacedFor };

/**
 * The extension a baseline's image is kept under: `webp` for every accept since
 * kept images became WebP (see `keepImage`), and `png` for one kept before.
 *
 * The record says which, as `image`, because the record is what a lookup reads
 * first and the only thing that may say what the pair is. Absent means `png`:
 * that is every record written before the field existed. Store-local, like
 * `placedFor`: the bytes declare their own format to everything downstream.
 */
export type KeptAs = 'png' | 'webp';
export const KEPT_AS: KeptAs = 'webp';
/** Every extension a store has kept an image under, the one it writes first. */
export const KEPT = ['webp', 'png'] as const satisfies readonly KeptAs[];

/** Whether a file name is a kept image, of either extension a store has written. */
export function isKeptImage(name: string): boolean {
  return KEPT.some((as) => name.endsWith(`.${as}`));
}

/** The image a record says is beside it. */
export function imageOf(places: Places, as: KeptAs): string {
  return `${places.image}.${as}`;
}

function keptAsIn(record: unknown): KeptAs {
  return (record as { image?: unknown }).image === 'webp' ? 'webp' : 'png';
}

/**
 * Every image of the pair that is on disk, of either extension. Read where the
 * record cannot say which to expect: when it is gone, and when it records no
 * image, since an image beside either is damage whatever its extension.
 */
async function imagesAt(places: Places): Promise<readonly string[]> {
  const found = await Promise.all(
    KEPT.map(async (as) => ((await orAbsent(() => stat(imageOf(places, as)), imageOf(places, as))) === null ? null : imageOf(places, as))),
  );
  return found.filter((path): path is string => path !== null);
}

/**
 * Remove a pair `put` just superseded, and its directories once empty: an
 * accept moves a baseline rather than leaving a second copy for the fallback.
 */
export async function retire(places: Places): Promise<void> {
  for (const as of KEPT) await rm(imageOf(places, as), { force: true });
  await rm(`${places.record}.json`, { force: true });
  for (const directory of new Set([dirname(places.image), dirname(places.record)])) {
    await rmdir(directory).catch(() => undefined);
  }
}

/**
 * A stored baseline, or a positive statement that there is none.
 *
 * `null` is earned by exactly one outcome: both halves of the pair are absent.
 * Everything else throws — one file without the other, a sidecar that will not
 * parse, EACCES after a permissions change, EMFILE under a run wide enough to
 * exhaust the descriptor table.
 *
 * The asymmetry is what forces this. A thrown error costs a re-run. A `null`
 * costs the baseline: it is read as `new`, `new` records whatever this build
 * painted, and the image it overwrites was the only evidence of what the subject
 * looked like before — all of it reported as success. So the failure that cannot
 * be distinguished from an empty directory must never be answered as one.
 *
 * *What it costs.* A genuinely corrupt pair stops the run until a person removes
 * it. The message names both files so the removal is a command rather than an
 * investigation.
 *
 * **This function is shared with the render cache and no longer decides what
 * happens there.** It used to, and the note here argued for it: stopping the run
 * over a corrupt cache entry was "accepted rather than special-cased", on the
 * grounds that a store with two rules about survivable failures is a store whose
 * behaviour depends on which path found the damage. The rules are two because the
 * *objects* are two — losing the thing being compared against is not losing a
 * copy of something we can paint again — so the distinction now lives in
 * `RenderCache` and not in a judgement made here. This still throws; the cache
 * wrapper reads the throw as a miss, and the baseline path does not.
 */
export async function readRaster(
  places: Places,
  readImage: ImageReader = readFile,
): Promise<Read<Raster> | null> {
  const found = await readPair(places);
  if (found === null) return null;
  if (found.image === undefined) return found.record;
  const image = found.image;
  // Absent here as well: the image was there a moment ago, and removed since.
  const bytes = await orAbsent(() => readImage(image), image);
  if (bytes === null) throw halfAPair(places, `${places.record}.json`, image);
  return { ...found.record, bytes: bytes.toString('base64') };
}

/**
 * The record, and the image it says is beside it, checked against what is on
 * disk; the image's bytes are left to the caller.
 *
 * The record is read first because it says which image to expect: its
 * dimensions say whether one was taken, and `image` says under which
 * extension. A lookup therefore costs the record, then a stat of each
 * extension, then — for `find` — the one image the record names.
 */
async function readPair(
  places: Places,
): Promise<{ record: Read<Omit<Raster, 'bytes'>>; image?: string } | null> {
  const recordPath = `${places.record}.json`;
  const text = await orAbsent(() => readFile(recordPath, 'utf8'), recordPath);
  if (text === null) {
    const [stray] = await imagesAt(places);
    if (stray === undefined) return null;
    throw halfAPair(places, stray, recordPath);
  }

  const { record, as } = parseSidecar(text, recordPath);
  const images = await imagesAt(places);
  // The sidecar says whether there should be an image: `width` and `height` are
  // written exactly when one was taken. So a pixel-less baseline is a `.json`
  // with no image *and no dimensions*, which is a complete record — and a
  // sidecar that claims dimensions with no image beside it is still damage.
  if (record.width === undefined) {
    const [stray] = images;
    if (stray !== undefined) throw unexpectedImage(places, stray);
    return { record };
  }
  const image = imageOf(places, as);
  // One image, the one the record names. Another beside it is a file from some
  // other accept, and which of the two is the baseline is not ours to guess.
  const stray = images.find((path) => path !== image);
  if (stray !== undefined) throw unexpectedImage(places, stray);
  if (!images.includes(image)) throw halfAPair(places, recordPath, image);
  return { record, image };
}

/**
 * The same lookup as {@link readRaster}, stopping short of the image.
 *
 * The image is still stat-ed. Skipping it would make the cheap lookup and the full
 * one disagree about whether a baseline exists — a sidecar whose image is gone
 * would be a description to one and a corrupted pair to the other, and the
 * verdict would then depend on which question the caller asked. A stat is a
 * directory read; it is the existence check without the megabyte.
 */
export async function readSidecar(places: Places): Promise<Read<Omit<Raster, 'bytes'>> | null> {
  return (await readPair(places))?.record ?? null;
}

/**
 * An image the sidecar does not claim: one beside a record of no pixels, or a
 * second image beside the one it names.
 *
 * The mirror of {@link halfAPair}, and damage for the same reason: the sidecar
 * is the record of what was observed, so an image it never claimed is a file
 * from some other run. Comparing against it would answer about that run.
 */
function unexpectedImage(places: Places, stray: string): RasterStoreError {
  return new RasterStoreError(
    `the baseline at ${places.record} does not record ${stray}, and it exists anyway. The sidecar ` +
      'is the record of what was observed, so an image it does not claim came from somewhere else. ' +
      `${REFUSAL}. Delete ${stray}, or delete the whole baseline to record the subject afresh.`,
  );
}

/**
 * One file of the pair without the other.
 *
 * Never a miss. An image with no `.json` is a baseline whose attribution was
 * lost, and a `.json` with no image is an attribution whose baseline was lost —
 * both are damage, and both look exactly like a subject nobody has rendered if
 * the lookup is willing to shrug. A CI cache restore that ran out of space and
 * a `put` killed between its two writes produce precisely this.
 *
 * Split roots do not soften it. Two directories are two things to restore, not a
 * licence to run on one of them: the message names the files it actually looked
 * for, wherever they were.
 */
function halfAPair(places: Places, present: string, missing: string): RasterStoreError {
  return new RasterStoreError(
    `the baseline at ${places.image} is half there: ${present} exists and ${missing} does not. ` +
      'A baseline is the pair, so one file without the other is a corrupted baseline rather ' +
      `than a missing one. ${REFUSAL}. Restore ${missing}, or delete ${present} to record ` +
      'the subject afresh.',
  );
}

/**
 * The sidecar, checked rather than cast.
 *
 * A cast is a claim about a file this process did not write in this run — one
 * that survived a cache restore, a merge, or a version of this package that
 * spelled the fields differently. Believed unchecked, a missing `documentDigest`
 * becomes `undefined` compared against a real digest, and a missing `identity`
 * becomes a digest taken over nothing: two invented answers where the honest one
 * is that the file cannot be read.
 */
function parseSidecar(text: string, path: string): { record: Read<Omit<Raster, 'bytes'>>; as: KeptAs } {
  refuseAPointerRecord(text, path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new RasterStoreError(
      `the baseline sidecar ${path} is not readable JSON: ${messageOf(error)}. ` +
        `A truncated write leaves exactly this. ${REFUSAL}.`,
      { cause: error },
    );
  }

  const sidecar = sidecarFrom(parsed);
  if (sidecar === null) {
    throw new RasterStoreError(
      `the baseline sidecar ${path} is not a raster record: it parsed, but does not carry a ` +
        `document digest and the identity that painted it. ${REFUSAL}.`,
    );
  }
  const placedFor = placedForIn(parsed);
  return { record: placedFor === undefined ? sidecar : { ...sidecar, placedFor }, as: keptAsIn(parsed) };
}
