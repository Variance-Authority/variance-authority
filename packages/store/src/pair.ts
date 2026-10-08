// compass: variance-authority.retention

import { readFile, stat } from 'node:fs/promises';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { REFUSAL, RasterStoreError, messageOf, sidecarFrom } from '@variance-authority/raster';
import { orAbsent } from './absent.js';

/**
 * One baseline read from disk: the image and the record of how it was painted,
 * found together or refused.
 *
 * Shared by every lookup the durable store makes — a baseline, a description, a
 * cached render — because each of them owes the same answer about a pair with
 * one half missing, and two copies of that answer are two chances to disagree.
 */

/**
 * Where the two halves of one baseline go.
 *
 * Equal prefixes unless {@link DurableStoreOptions.recordRoot} is set, which is
 * why the split costs a reader nothing to ignore: every path in this file comes
 * from one call, and the default makes both fields the string the file used to
 * pass around.
 */
export interface Places {
  /** The `.png`'s path, without the extension. */
  readonly image: string;
  /** The `.json`'s path, without the extension. */
  readonly record: string;
}

export async function load(
  places: Places,
): Promise<{ raster: Raster; identity: RenderIdentity } | null> {
  const raster = await readRaster(places);
  return raster === null ? null : { raster, identity: raster.identity };
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
export async function readRaster(places: Places): Promise<Raster | null> {
  const [sidecar, bytes] = await Promise.all([
    orAbsent(() => readFile(`${places.record}.json`, 'utf8'), `${places.record}.json`),
    orAbsent(() => readFile(`${places.image}.png`), `${places.image}.png`),
  ]);

  if (sidecar === null && bytes === null) return null;
  if (sidecar === null) throw halfAPair(places, false);

  const record = parseSidecar(sidecar, `${places.record}.json`);
  // The sidecar says whether there should be an image: `width` and `height` are
  // written exactly when one was taken. So a pixel-less baseline is a `.json`
  // with no `.png` *and no dimensions*, which is a complete record — and a
  // sidecar that claims dimensions with no image beside it is still damage.
  if (record.width === undefined) {
    if (bytes !== null) throw unexpectedImage(places);
    return record;
  }
  if (bytes === null) throw halfAPair(places, true);

  return { ...record, bytes: bytes.toString('base64') };
}

/**
 * The same lookup as {@link readRaster}, stopping short of the image.
 *
 * The PNG is still stat-ed. Skipping it would make the cheap lookup and the full
 * one disagree about whether a baseline exists — a sidecar whose image is gone
 * would be a description to one and a corrupted pair to the other, and the
 * verdict would then depend on which question the caller asked. A stat is a
 * directory read; it is the existence check without the megabyte.
 */
export async function readSidecar(places: Places): Promise<Omit<Raster, 'bytes'> | null> {
  const [sidecar, image] = await Promise.all([
    orAbsent(() => readFile(`${places.record}.json`, 'utf8'), `${places.record}.json`),
    orAbsent(() => stat(`${places.image}.png`), `${places.image}.png`),
  ]);

  if (sidecar === null && image === null) return null;
  if (sidecar === null) throw halfAPair(places, false);

  const record = parseSidecar(sidecar, `${places.record}.json`);
  if (record.width === undefined) {
    if (image !== null) throw unexpectedImage(places);
    return record;
  }
  if (image === null) throw halfAPair(places, true);

  return record;
}

/**
 * A `.png` beside a sidecar that recorded no image.
 *
 * The mirror of {@link halfAPair}, and damage for the same reason: the sidecar
 * is the record of what was observed, so an image it never claimed is a file
 * from some other run. Comparing against it would answer about that run.
 */
function unexpectedImage(places: Places): RasterStoreError {
  return new RasterStoreError(
    `the baseline at ${places.record} records a subject with no pixels, and ` +
      `${places.image}.png exists anyway. The sidecar is the record of what was observed, so an ` +
      `image it does not claim came from somewhere else. ${REFUSAL}. Delete ${places.image}.png, ` +
      'or delete both to record the subject afresh.',
  );
}

/**
 * One file of the pair without the other.
 *
 * Never a miss. A `.png` with no `.json` is a baseline whose attribution was
 * lost, and a `.json` with no `.png` is an attribution whose baseline was lost —
 * both are damage, and both look exactly like a subject nobody has rendered if
 * the lookup is willing to shrug. A CI cache restore that ran out of space and
 * a `put` killed between its two writes produce precisely this.
 *
 * Split roots do not soften it. Two directories are two things to restore, not a
 * licence to run on one of them: the message names the files it actually looked
 * for, wherever they were.
 */
function halfAPair(places: Places, sidecarSurvived: boolean): RasterStoreError {
  const [present, missing] = sidecarSurvived
    ? [`${places.record}.json`, `${places.image}.png`]
    : [`${places.image}.png`, `${places.record}.json`];

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
function parseSidecar(text: string, path: string): Omit<Raster, 'bytes'> {
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
  return sidecar;
}
