// compass: variance-authority.retention

import { mkdir, readFile, readdir, rm, rmdir, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  digestFileName,
  identityDigest,
  occupiesPixels,
  type Digest,
  type Raster,
} from '@variance-authority/core/format';
import {
  neverFails,
  type BaselineKey,
  type Described,
  type Found,
  type RasterStore,
} from '@variance-authority/raster';
import { orAbsent } from './absent.js';
import { load, readRaster, readSidecar, type ImageReader, type Places } from './pair.js';
import { held } from './held.js';
import { holder, identityOfPartition, partitionsOf, pathFor } from './placement.js';
import type { BaselineLayout } from './placement.js';

/**
 * Re-exported rather than moved out of reach: `BaselineLayout` is a word an
 * operator sets in a config file and a word `lfs.ts` takes in its options, and
 * neither of those should have to learn that the placement rules moved into a
 * file of their own.
 */
export type { BaselineLayout } from './placement.js';
export type { ImageReader } from './pair.js';

/**
 * Re-exported for {@link BaselineLayout}'s reason, and one more: the bound on
 * the render cache is only meaningful to whoever passed
 * {@link DurableStoreOptions.cacheRoot}, and that is this entrypoint's caller.
 */
export {
  sweepRenderCache,
  type RenderCacheBound,
  type RenderCacheSwept,
} from './retention.js';

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

  /**
   * How a baseline's image is read, when `find` needs its bytes.
   *
   * Defaults to reading the file. The LFS store passes a reader that fetches
   * the image first when the working tree holds its pointer, so the placement
   * that says where the file is stays here and nowhere else. A reader that
   * throws ENOENT means no image, and any other throw refuses the lookup, as a
   * read of the file would. The render cache and `describe` never call it.
   */
  readonly readImage?: ImageReader;
}

export function createDurableStore(root: string, options: DurableStoreOptions = {}): RasterStore {
  const cacheRoot = options.cacheRoot ?? root;
  const recordRoot = options.recordRoot ?? root;
  const layout = options.layout ?? 'flat';
  const readImage = options.readImage ?? readFile;
  const holderFor = (key: BaselineKey): string => holder(recordRoot, layout, key);
  const placesFor = (key: BaselineKey, partition: string): Places => ({
    image: pathFor(holder(root, layout, key), partition, key, layout),
    record: pathFor(holder(recordRoot, layout, key), partition, key, layout),
  });

  return {
    retention: 'durable',

    async find(key, identity): Promise<Found | null> {
      for await (const { partition, comparable } of searched(holderFor(key), identityDigest(identity))) {
        const found = await load(placesFor(key, partition), readImage);
        if (found !== null) return { raster: found.raster, comparable, storedUnder: found.identity };
      }
      return null;
    },

    async describe(key, identity): Promise<Described | null> {
      // The same search as `find`, over the same layout, reading the sidecar and
      // only stat-ing the image. Written out rather than expressed in terms of
      // `find`, because "in terms of `find`" is precisely the megabyte this
      // exists to not spend.
      for await (const { partition, comparable } of searched(holderFor(key), identityDigest(identity))) {
        const sidecar = await readSidecar(placesFor(key, partition));
        if (sidecar === null) continue;
        return {
          documentDigest: sidecar.documentDigest,
          comparable,
          storedUnder: sidecar.identity,
          pictured: occupiesPixels(sidecar),
          missingFonts: sidecar.missingFonts,
          ...(sidecar.accessibility === undefined ? {} : { accessibility: sidecar.accessibility }),
          // Names only. The sidecar carries hashes; a describe that handed them
          // on would invite a caller to settle from them, which is the document
          // digest's job — this list can only answer membership.
          ...(sidecar.components === undefined
            ? {}
            : { components: sidecar.components.map((hash) => hash.component) }),
          ...(sidecar.findingMarks === undefined ? {} : { findingMarks: sidecar.findingMarks }),
        };
      }
      return null;
    },

    async put(key, raster): Promise<void> {
      const [written, legacy] = partitionsOf(identityDigest(raster.identity));
      const places = placesFor(key, written);
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
      await retire(placesFor(key, legacy));
    },

    /**
     * The plan's complement, taken over paths this store alone can compute.
     *
     * The enumeration is in `held.ts` for {@link placement}'s reason: it decides
     * nothing about a verdict, and every line of it is about *which path*.
     */
    async unplanned(keys, identity): Promise<readonly string[]> {
      const digest = identityDigest(identity);
      const planned = new Set(
        keys.flatMap((key) =>
          partitionsOf(digest).map((partition) => `${pathFor(holderFor(key), partition, key, layout)}.json`),
        ),
      );
      return held(recordRoot, digest, planned);
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
        const path = cachedAt(cacheRoot, identityDigest(identity), digest);
        const raster = await readRaster({ image: path, record: path });
        if (raster !== null) await touch(path);
        return raster;
      },

      async put(raster): Promise<void> {
        const path = cachedAt(cacheRoot, identityDigest(raster.identity), raster.documentDigest);
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
 * Mark an entry as wanted, so the sweep can tell live keys from dead ones.
 *
 * The only signal a cache entry carries about its own value. A render is
 * addressed by the digest of the document that produced it, so an entry stops
 * being reachable the moment the source moves — nothing will ever ask for that
 * key again, and from the outside it is indistinguishable from an entry that is
 * hit on every run. The difference is only visible here, at the hit, which is
 * why `sweepRenderCache` reads mtimes and this writes them.
 *
 * Both halves, and failures swallowed. A clock that did not move costs the
 * entry its place in the next sweep, which costs a render; refusing the hit
 * over it would cost the same render now, and a read-only cache directory would
 * turn every hit into a miss.
 */
async function touch(path: string): Promise<void> {
  const when = new Date();
  await Promise.all(
    [`${path}.png`, `${path}.json`].map(async (file) => {
      try {
        await utimes(file, when, when);
      } catch {
        // Absent, or not ours to stamp. Neither changes what was read.
      }
    }),
  );
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
    .filter((entry) => entry.isDirectory() && identityOfPartition(entry.name) !== undefined)
    .map((entry) => entry.name);
}

/**
 * The partitions a lookup reads, in the order it reads them, and whether each is this machine's.
 *
 * This machine's written name first and alone, so a hit costs no `readdir`.
 * Then the scan, with this machine's raw-digest name ahead of every other
 * identity: a subject held under both would otherwise answer `incomparable`
 * from a neighbour while a comparable baseline sat one directory over.
 */
async function* searched(
  holder: string,
  mine: Digest,
): AsyncGenerator<{ partition: string; comparable: boolean }> {
  const [written, legacy] = partitionsOf(mine);
  yield { partition: written, comparable: true };
  const scanned = await identities(holder);
  if (scanned.includes(legacy)) yield { partition: legacy, comparable: true };
  for (const other of scanned) {
    if (identityOfPartition(other) !== mine) yield { partition: other, comparable: false };
  }
}

/**
 * Remove the raw-digest pair `put` just superseded, and its directories once empty:
 * an accept moves a baseline rather than leaving a second copy for the fallback.
 */
async function retire(places: Places): Promise<void> {
  await rm(`${places.image}.png`, { force: true });
  await rm(`${places.record}.json`, { force: true });
  for (const directory of new Set([dirname(places.image), dirname(places.record)])) {
    await rmdir(directory).catch(() => undefined);
  }
}

/**
 * A render cache entry's path. No raw-digest fallback, unlike a baseline: a cache
 * entry nobody finds costs one render, and `sweepRenderCache` ages the old ones out.
 */
function cachedAt(cacheRoot: string, identity: Digest, documentDigest: Digest): string {
  return join(cacheRoot, digestFileName(identity), 'by-document', digestFileName(documentDigest));
}
