// compass: variance-authority.retention

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  identityDigest,
  occupiesPixels,
  type Digest,
  type Raster,
  type RenderIdentity,
} from '@variance-authority/core/format';
import {
  REFUSAL,
  RasterStoreError,
  messageOf,
  sidecarFrom,
  neverFails,
  type BaselineKey,
  type Described,
  type Found,
  type RasterStore,
} from '@variance-authority/raster';
import { IDENTITY_DIRECTORY, holder, pathFor, type BaselineLayout } from './placement.js';

/**
 * Re-exported rather than moved out of reach: `BaselineLayout` is a word an
 * operator sets in a config file and a word `lfs.ts` takes in its options, and
 * neither of those should have to learn that the placement rules moved into a
 * file of their own.
 */
export type { BaselineLayout } from './placement.js';

/**
 * On disk, partitioned by renderer identity.
 *
 * The layout is the rule. `<root>/<identityDigest>/<subject>[.label].png` means
 * a baseline written by one machine cannot be silently picked up by another —
 * not by convention or by a check somebody remembered to write, but because it
 * is not in the directory the other machine reads. `find` then scans the sibling
 * identities so it can say what it *did* find, which is what turns a wrong-machine
 * run from a mysterious mass failure into one sentence.
 *
 * What this file needs that the contract does not is a **filesystem**, which is
 * the reason it is not next to the contract. Everything about what a baseline
 * *means* — the shape of a record, the refusal, the wording — is in
 * `@variance-authority/raster` and is shared with every other backend.
 */

export interface DurableStoreOptions {
  /**
   * Where a subject's baseline sits under the root. See {@link BaselineLayout}.
   */
  readonly layout?: BaselineLayout;

  /**
   * Where the `.json` records go, if not beside the images.
   *
   * A baseline is an image and a record of how it was painted, and only the
   * image is the thing being reviewed. The record changes whenever the document
   * changes — a class name, a build id, a font that resolved differently — so a
   * record committed beside its image turns *every* edit into a diff under
   * version control, including the edits that moved no pixel. Pointed at an
   * ignored directory, a CI cache or a database export, the tracked root holds
   * images and nothing else.
   *
   * **Both halves are still written and still read.** This moves the record's
   * directory; it does not make the record optional. A store that finds one half
   * of a baseline without the other still refuses, because a record that went
   * missing is a baseline that can no longer say which machine painted it.
   *
   * Left unset the records stay beside the images, which is the placement that
   * needs no second location to survive a checkout. Unlike {@link cacheRoot}
   * this is the operator's to set and not a thing the CLI may infer: a lost
   * cache entry costs a render, and a lost record costs the run its
   * `missingFonts` and its `findingMarks` — evidence a verdict is allowed to
   * turn on.
   */
  readonly recordRoot?: string;

  /**
   * Where the render cache goes, if not beside the baselines.
   *
   * A durable store is also a render cache, and the cache is keyed by document
   * digest — so it gains an entry for every edit and is worth nothing after the
   * next one. Beside the baselines it shares their fate: a root the operator
   * commits, and every placement in
   * [`placement.md`](../../../docs/placement.md) except `remote` is one an
   * operator commits. The tracked root then grows without bound with images
   * nobody will look at, and the quota bought for baselines pays for them.
   *
   * Left unset the cache stays under `root`, which is what a store with no
   * opinion about the work tree should do. The CLI sets it, because the CLI is
   * the caller that knows the root is tracked.
   */
  readonly cacheRoot?: string;
}

export function createDurableStore(root: string, options: DurableStoreOptions = {}): RasterStore {
  const cacheRoot = options.cacheRoot ?? root;
  const recordRoot = options.recordRoot ?? root;
  const layout = options.layout ?? 'flat';
  const holderFor = (key: BaselineKey): string => holder(recordRoot, layout, key);
  const placesFor = (key: BaselineKey, identity: Digest): Places => ({
    image: pathFor(holder(root, layout, key), identity, key, layout),
    record: pathFor(holder(recordRoot, layout, key), identity, key, layout),
  });

  return {
    retention: 'durable',

    async find(key, identity): Promise<Found | null> {
      const mine = identityDigest(identity);
      const own = await load(placesFor(key, mine));
      if (own !== null) return { raster: own.raster, comparable: true, storedUnder: own.identity };

      for (const other of await identities(holderFor(key))) {
        if (other === mine) continue;
        const found = await load(placesFor(key, other));
        if (found !== null) {
          return { raster: found.raster, comparable: false, storedUnder: found.identity };
        }
      }
      return null;
    },

    async describe(key, identity): Promise<Described | null> {
      // The same search as `find`, over the same layout, reading the sidecar and
      // only stat-ing the image. Written out rather than expressed in terms of
      // `find`, because "in terms of `find`" is precisely the megabyte this
      // exists to not spend.
      const mine = identityDigest(identity);
      const own = await readSidecar(placesFor(key, mine));
      if (own !== null) {
        return {
          documentDigest: own.documentDigest,
          comparable: true,
          storedUnder: own.identity,
          pictured: occupiesPixels(own),
          missingFonts: own.missingFonts,
          ...(own.accessibility === undefined ? {} : { accessibility: own.accessibility }),
          // Names only. The sidecar carries hashes; a describe that handed them
          // on would invite a caller to settle from them, which is the document
          // digest's job — this list can only answer membership.
          ...(own.components === undefined
            ? {}
            : { components: own.components.map((hash) => hash.component) }),
          ...(own.findingMarks === undefined ? {} : { findingMarks: own.findingMarks }),
        };
      }

      for (const other of await identities(holderFor(key))) {
        if (other === mine) continue;
        const sidecar = await readSidecar(placesFor(key, other));
        if (sidecar !== null) {
          return {
            documentDigest: sidecar.documentDigest,
            comparable: false,
            storedUnder: sidecar.identity,
            pictured: occupiesPixels(sidecar),
            missingFonts: sidecar.missingFonts,
            ...(sidecar.accessibility === undefined
              ? {}
              : { accessibility: sidecar.accessibility }),
            ...(sidecar.components === undefined
              ? {}
              : { components: sidecar.components.map((hash) => hash.component) }),
            ...(sidecar.findingMarks === undefined
              ? {}
              : { findingMarks: sidecar.findingMarks }),
          };
        }
      }
      return null;
    },

    async put(key, raster): Promise<void> {
      const places = placesFor(key, identityDigest(raster.identity));
      await mkdir(dirname(places.record), { recursive: true });
      // No image for a subject that has none. The sidecar alone is the whole
      // baseline there, and it says so by carrying no dimensions.
      if (raster.bytes !== undefined) {
        await mkdir(dirname(places.image), { recursive: true });
        await writeFile(`${places.image}.png`, Buffer.from(raster.bytes, 'base64'));
      }
      // The sidecar carries the identity in readable form. A directory named by a
      // digest is unreviewable, and a baseline nobody can attribute to a machine
      // is a baseline nobody can decide to discard.
      await writeFile(
        `${places.record}.json`,
        `${JSON.stringify({ ...raster, bytes: undefined }, null, 2)}\n`,
        'utf8',
      );
    },

    // A durable store is also a render cache: an unchanged document under an
    // unchanged identity has an image already, and the cheapest render is the
    // one that does not happen.
    //
    // Wrapped, so an unreadable entry, a full disk or a directory somebody
    // chmod-ed costs this run a render instead of ending it. The baseline half
    // above still throws for all three, which is the difference the split is
    // about: one of these is the thing being compared against and one is a copy
    // of something we can make again.
    renderCache: neverFails({
      async get(digest, identity): Promise<Raster | null> {
        // One prefix for both halves. The cache's record is as regenerable as
        // its image, so there is nothing here for a split root to save.
        const path = join(cacheRoot, identityDigest(identity), 'by-document', digest);
        return readRaster({ image: path, record: path });
      },

      async put(raster): Promise<void> {
        const path = join(
          cacheRoot,
          identityDigest(raster.identity),
          'by-document',
          raster.documentDigest,
        );
        await mkdir(dirname(path), { recursive: true });
        if (raster.bytes !== undefined) {
          await writeFile(`${path}.png`, Buffer.from(raster.bytes, 'base64'));
        }
        await writeFile(
          `${path}.json`,
          `${JSON.stringify({ ...raster, bytes: undefined })}\n`,
          'utf8',
        );
      },
    }),
  };
}


/**
 * Where the two halves of one baseline go.
 *
 * Equal prefixes unless {@link DurableStoreOptions.recordRoot} is set, which is
 * why the split costs a reader nothing to ignore: every path in this file comes
 * from one call, and the default makes both fields the string the file used to
 * pass around.
 */
interface Places {
  /** The `.png`'s path, without the extension. */
  readonly image: string;
  /** The `.json`'s path, without the extension. */
  readonly record: string;
}

/**
 * The identities that have written here, or none because nobody has.
 *
 * Scanned in the **record** root rather than the image root. Every baseline has
 * a record and only a pictured one has an image, so a scan of the images would
 * miss the identity that painted a subject with no pixels — and report `new` for
 * a subject another machine has already recorded, which is the exact sentence
 * this scan exists to prevent.
 *
 * A root that does not exist is a legitimate empty answer — the first run on a
 * fresh checkout creates it on `put`. A root that exists and cannot be listed is
 * not: the sibling scan is the only thing that turns a wrong-machine run into
 * `incomparable` instead of `new`, so a directory this process was refused would
 * otherwise quietly downgrade that sentence into the one that re-records.
 */
async function identities(holder: string): Promise<readonly string[]> {
  const entries = await orAbsent(() => readdir(holder, { withFileTypes: true }), holder);
  if (entries === null) return [];
  return entries
    .filter((entry) => entry.isDirectory() && IDENTITY_DIRECTORY.test(entry.name))
    .map((entry) => entry.name);
}

async function load(
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
async function readRaster(places: Places): Promise<Raster | null> {
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
async function readSidecar(places: Places): Promise<Omit<Raster, 'bytes'> | null> {
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
 * `null` for ENOENT, and for nothing else.
 *
 * The one errno that answers the question rather than failing to. Every other
 * one — a permission, a descriptor, an I/O error on a network mount — means this
 * process could not establish what is on disk, which is not the same fact and
 * must not be reported as it.
 */
async function orAbsent<T>(read: () => Promise<T>, path: string): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (isMissing(error)) return null;
    throw new RasterStoreError(
      `the baseline store could not read ${path}: ${messageOf(error)}. ${REFUSAL}.`,
      { cause: error },
    );
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
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
