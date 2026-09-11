// compass: variance-authority.retention

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  identityDigest,
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
/**
 * Where a subject's baseline sits under the root.
 *
 * `flat` is the original and the default: every image for the root lives under
 * one identity directory, and a subject id with slashes in it is percent-encoded
 * into a single filename. It is the placement to take when the baselines are a
 * corpus — a directory somebody backs up, prunes, or points a bucket at.
 *
 * `beside` spends the slashes instead of encoding them, so `components/Button/primary`
 * lands in `components/Button/`. With the root pointed at the source tree the
 * baseline is in the directory holding the component it is a baseline of, which
 * is what puts it in the same review, the same move and the same delete as the
 * code. `docs/placement.md` is the page that chooses between them.
 *
 * The identity partition is unchanged either way — it moves down to the leaf
 * directory rather than disappearing, because a baseline painted by another
 * machine must still be in a directory this one does not read
 * ([ADR-0011](../../../docs/context/adr/0011-durable-and-ephemeral-retention.md)).
 */
export type BaselineLayout = 'flat' | 'beside';

export interface DurableStoreOptions {
  /**
   * Where a subject's baseline sits under the root. See {@link BaselineLayout}.
   */
  readonly layout?: BaselineLayout;

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
  const layout = options.layout ?? 'flat';
  const holderFor = (key: BaselineKey): string => holder(root, layout, key);

  return {
    retention: 'durable',

    async find(key, identity): Promise<Found | null> {
      const mine = identityDigest(identity);
      const where = holderFor(key);
      const own = await load(where, mine, key, layout);
      if (own !== null) return { raster: own.raster, comparable: true, storedUnder: own.identity };

      for (const other of await identities(where)) {
        if (other === mine) continue;
        const found = await load(where, other, key, layout);
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
      const where = holderFor(key);
      const own = await readSidecar(pathFor(where, mine, key, layout));
      if (own !== null) {
        return {
          documentDigest: own.documentDigest,
          comparable: true,
          storedUnder: own.identity,
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

      for (const other of await identities(where)) {
        if (other === mine) continue;
        const sidecar = await readSidecar(pathFor(where, other, key, layout));
        if (sidecar !== null) {
          return {
            documentDigest: sidecar.documentDigest,
            comparable: false,
            storedUnder: sidecar.identity,
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
      const path = pathFor(holderFor(key), identityDigest(raster.identity), key, layout);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.png`, Buffer.from(raster.bytes, 'base64'));
      // The sidecar carries the identity in readable form. A directory named by a
      // digest is unreviewable, and a baseline nobody can attribute to a machine
      // is a baseline nobody can decide to discard.
      await writeFile(
        `${path}.json`,
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
        return readRaster(join(cacheRoot, identityDigest(identity), 'by-document', digest));
      },

      async put(raster): Promise<void> {
        const path = join(
          cacheRoot,
          identityDigest(raster.identity),
          'by-document',
          raster.documentDigest,
        );
        await mkdir(dirname(path), { recursive: true });
        await writeFile(`${path}.png`, Buffer.from(raster.bytes, 'base64'));
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
 * What an identity directory is named, so a scan can tell one from a neighbour.
 *
 * `flat` never needed this — everything under the root was a partition. `beside`
 * puts partitions among the subject's own siblings, where `Button/` and
 * `by-document/` are directories too, and a sibling scan that reported them as
 * machine identities would answer `incomparable` naming a component.
 */
const IDENTITY_DIRECTORY = /^v1:[0-9a-f]{32}$/;

function pathFor(holder: string, identity: Digest, key: BaselineKey, layout: BaselineLayout): string {
  return join(holder, identity, encodeURIComponent(fileName(key, layout)));
}

/**
 * The directory holding this key's identity partitions.
 *
 * `flat` answers the root for every key, which is what makes one `readdir` the
 * whole sibling scan. `beside` answers the subject's own directory, so the scan
 * that turns a wrong-machine run into `incomparable` reads that directory rather
 * than the tree — cheaper, and scoped to the subject actually being asked about.
 */
function holder(root: string, layout: BaselineLayout, key: BaselineKey): string {
  if (layout === 'flat') return root;
  return join(root, ...segments(key.subject).slice(0, -1));
}

function fileName(key: BaselineKey, layout: BaselineLayout): string {
  const subject = layout === 'flat' ? key.subject : segments(key.subject).at(-1) as string;
  return key.label === undefined ? subject : `${subject}__${key.label}`;
}

/**
 * A subject id split into path segments, refusing the ones that escape the root.
 *
 * Only `beside` splits, and only `beside` can therefore be steered by a subject
 * id: a collector naming a subject `../../etc/hosts` would otherwise write a PNG
 * wherever the id said. `..`, an absolute id and an empty segment are refused by
 * name, because the alternative is a store whose write location is decided by
 * whatever produced the plan.
 */
function segments(subject: string): readonly string[] {
  if (subject.startsWith('/')) {
    throw new RasterStoreError(`subject id ${JSON.stringify(subject)} is an absolute path`);
  }
  const parts = subject.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') {
      throw new RasterStoreError(
        `subject id ${JSON.stringify(subject)} has a ${JSON.stringify(part)} segment, and a ` +
          '`beside` layout would write outside the baseline root. Use the `flat` layout, or ' +
          'give the subject an id that is a path.',
      );
    }
  }
  return parts;
}

/**
 * The identities that have written here, or none because nobody has.
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
  holder: string,
  identity: string,
  key: BaselineKey,
  layout: BaselineLayout,
): Promise<{ raster: Raster; identity: RenderIdentity } | null> {
  const raster = await readRaster(pathFor(holder, identity, key, layout));
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
async function readRaster(path: string): Promise<Raster | null> {
  const [sidecar, bytes] = await Promise.all([
    orAbsent(() => readFile(`${path}.json`, 'utf8'), `${path}.json`),
    orAbsent(() => readFile(`${path}.png`), `${path}.png`),
  ]);

  if (sidecar === null && bytes === null) return null;
  if (sidecar === null || bytes === null) throw halfAPair(path, sidecar !== null);

  return { ...parseSidecar(sidecar, `${path}.json`), bytes: bytes.toString('base64') };
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
async function readSidecar(path: string): Promise<Omit<Raster, 'bytes'> | null> {
  const [sidecar, image] = await Promise.all([
    orAbsent(() => readFile(`${path}.json`, 'utf8'), `${path}.json`),
    orAbsent(() => stat(`${path}.png`), `${path}.png`),
  ]);

  if (sidecar === null && image === null) return null;
  if (sidecar === null || image === null) throw halfAPair(path, sidecar !== null);

  return parseSidecar(sidecar, `${path}.json`);
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
 * One file of the pair without the other.
 *
 * Never a miss. A `.png` with no `.json` is a baseline whose attribution was
 * lost, and a `.json` with no `.png` is an attribution whose baseline was lost —
 * both are damage, and both look exactly like a subject nobody has rendered if
 * the lookup is willing to shrug. A CI cache restore that ran out of space and
 * a `put` killed between its two writes produce precisely this.
 */
function halfAPair(path: string, sidecarSurvived: boolean): RasterStoreError {
  const [present, missing] = sidecarSurvived
    ? [`${path}.json`, `${path}.png`]
    : [`${path}.png`, `${path}.json`];

  return new RasterStoreError(
    `the baseline at ${path} is half there: ${present} exists and ${missing} does not. ` +
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
