import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  documentDigest,
  identityDigest,
  type Digest,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
} from '@variance-authority/core';
import type { Renderer } from './renderer.js';

/**
 * Retention — the two modes, and the honest difference between them.
 *
 * **Durable.** The image is kept and compared against on a later run, possibly a
 * later week. That is only sound if the two images came from the same machine,
 * because rasterization is machine-bound — a different GPU, driver, font stack,
 * or scale factor paints the same markup differently. The industry answer is to
 * pin the whole pipeline in a container and pay for it everywhere. The answer
 * here is narrower: *state the machine, and refuse to compare across it.*
 *
 * **Ephemeral.** Both images are produced now, by one renderer, and thrown away.
 * The machine cancels out by construction — there is no second machine — so the
 * comparison needs no pinning, no container, and no stored artifact at all. This
 * is the mode that answers "we need to defer, optimize, or offload the rendering
 * in any possible way", because it removes the requirement rather than paying it.
 *
 * The interface is shared so a pipeline can be written once and run either way.
 * What differs is not the code that compares; it is where the other image comes
 * from and whether anyone is allowed to trust it later.
 */

export type Retention = 'durable' | 'ephemeral';

/**
 * Something went wrong with the *store*, as distinct from something being true
 * about the subject.
 *
 * A distinct type because the caller has to distinguish them and a message
 * cannot be matched on. Spec 0003 gives operator error its own exit code
 * precisely so a CI job can tell "this needs review" from "this did not run",
 * and a verdict and a crash sharing a code is the thing that makes a red build
 * uninformative.
 *
 * Declared here, beside the interface, rather than with the HTTP client that
 * first needed it. Every backend has to be able to fail without being heard as
 * an answer — a disk says EACCES where a socket says 500 — and an error type
 * owned by one transport invites the others to invent their own, which is how
 * `run.ts` would end up with a list of failures to recognise instead of one.
 */
export class RasterStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RasterStoreError';
  }
}

/**
 * The sentence appended to every store failure, because the consequence avoided
 * is not obvious from the errno and is the reason the run is stopping.
 */
export const REFUSAL =
  'This is an operator error, not a verdict: reporting it as a missing baseline would ' +
  'record whatever is on screen and overwrite the baseline this run was meant to compare ' +
  'against';

export interface BaselineKey {
  readonly subject: string;
  /** Distinguishes several images of one subject, e.g. a viewport or a state. */
  readonly label?: string;
}

export interface Found {
  readonly raster: Raster;
  /**
   * `true` when the stored image was produced by the identity now asking for it.
   *
   * The whole point of the durable mode. A stored baseline from another machine
   * is not a baseline — comparing against it produces a large, confident,
   * meaningless diff, and the report then blames a component for a driver.
   */
  readonly comparable: boolean;
  readonly storedUnder: RenderIdentity;
}

/**
 * A baseline's attributes without the baseline — what a lookup can say about a
 * stored image from its sidecar alone.
 *
 * Exactly the three fields that decide whether an image is needed at all. There
 * is no `raster` here and there must not be one: the moment this type can carry
 * bytes, a caller can be handed them by accident and the saving disappears.
 */
export interface Described {
  /** The digest of the document the stored image was painted from. */
  readonly documentDigest: Digest;
  /** As {@link Found.comparable} — whether the identity now asking wrote it. */
  readonly comparable: boolean;
  readonly storedUnder: RenderIdentity;
}

export interface RasterStore {
  readonly retention: Retention;

  /**
   * Look up a baseline for this key *under any identity*.
   *
   * Deliberately not scoped to the current identity. Returning nothing for a
   * baseline that exists but was written elsewhere would report "new subject",
   * and "we have never seen this" is a different and much less useful sentence
   * than "we have seen this, on a machine you are not".
   */
  find(key: BaselineKey, identity: RenderIdentity): Promise<Found | null>;

  /**
   * The same lookup, decided without the image.
   *
   * Most subjects in a run are settled by 32 hex characters: if the document
   * this run assembled digests to what the baseline was painted from, and one
   * machine painted both, then no image can differ and none is needed. Both
   * facts live in the sidecar, a few hundred bytes of text — yet `find` answers
   * by reading the PNG and base64 encoding it, so a suite of three hundred
   * subjects moves a few hundred megabytes to make three hundred string
   * comparisons. Across a hop it moves them twice.
   *
   * *What it costs.* This is not a cheaper `find` — it cannot say what changed,
   * only whether anything could have. A caller that then has to compare pays for
   * a second, full lookup, so a suite where everything moved does strictly more
   * work than before. The trade is deliberate: the common case is that almost
   * nothing moved.
   *
   * Failure is governed by the same rule as `find`. `null` means the store
   * looked and there is no baseline, never that it could not look.
   */
  describe(key: BaselineKey, identity: RenderIdentity): Promise<Described | null>;

  put(key: BaselineKey, raster: Raster): Promise<void>;

  /** Rasters already produced this run, keyed by document digest. See {@link renderCached}. */
  cached(digest: Digest, identity: RenderIdentity): Promise<Raster | null>;
  cache(raster: Raster): Promise<void>;
}

/**
 * In-memory, discarded when the process ends.
 *
 * `find` never returns anything: an ephemeral run has no past. Both images are
 * rendered in the same run and the caller compares them directly, which is why
 * this mode has nothing to say about comparability — there is only one machine
 * in the story.
 */
export function createEphemeralStore(): RasterStore {
  const cache = new Map<string, Raster>();

  return {
    retention: 'ephemeral',
    async find(): Promise<Found | null> {
      return null;
    },
    async describe(): Promise<Described | null> {
      // Nothing to be cheap about. Answering `null` here is the same statement
      // `find` makes and is made for the same reason: this mode has no past.
      return null;
    },
    async put(): Promise<void> {
      // Nothing is kept. Making this a silent no-op rather than a throw lets one
      // pipeline serve both modes, which is the point of the shared interface.
    },
    async cached(digest, identity): Promise<Raster | null> {
      return cache.get(`${digest}/${identityDigest(identity)}`) ?? null;
    },
    async cache(raster): Promise<void> {
      cache.set(`${raster.documentDigest}/${identityDigest(raster.identity)}`, raster);
    },
  };
}

/**
 * On disk, partitioned by renderer identity.
 *
 * The layout is the rule. `<root>/<identityDigest>/<subject>[.label].png` means
 * a baseline written by one machine cannot be silently picked up by another —
 * not by convention or by a check somebody remembered to write, but because it
 * is not in the directory the other machine reads. `find` then scans the sibling
 * identities so it can say what it *did* find, which is what turns a wrong-machine
 * run from a mysterious mass failure into one sentence.
 */
export function createDurableStore(root: string): RasterStore {
  return {
    retention: 'durable',

    async find(key, identity): Promise<Found | null> {
      const mine = identityDigest(identity);
      const own = await load(root, mine, key);
      if (own !== null) return { raster: own.raster, comparable: true, storedUnder: own.identity };

      for (const other of await identities(root)) {
        if (other === mine) continue;
        const found = await load(root, other, key);
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
      const own = await readSidecar(pathFor(root, mine, key));
      if (own !== null) {
        return { documentDigest: own.documentDigest, comparable: true, storedUnder: own.identity };
      }

      for (const other of await identities(root)) {
        if (other === mine) continue;
        const sidecar = await readSidecar(pathFor(root, other, key));
        if (sidecar !== null) {
          return {
            documentDigest: sidecar.documentDigest,
            comparable: false,
            storedUnder: sidecar.identity,
          };
        }
      }
      return null;
    },

    async put(key, raster): Promise<void> {
      const path = pathFor(root, identityDigest(raster.identity), key);
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

    async cached(digest, identity): Promise<Raster | null> {
      // A durable store is also a render cache: an unchanged document under an
      // unchanged identity has an image already, and the cheapest render is the
      // one that does not happen.
      const path = join(root, identityDigest(identity), 'by-document', digest);
      return readRaster(path);
    },

    async cache(raster): Promise<void> {
      const path = join(
        root,
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
  };
}

/**
 * Render a document, unless an identical one has already been rendered.
 *
 * The deferral lever, in one function. Content addressing means "identical" is a
 * fact about the document rather than a guess about the branch (Principle 4), so
 * a rebase, a file move, or a rerun costs nothing, and a run over 300 subjects
 * where two changed pays for two images.
 */
export async function renderCached(
  renderer: Renderer,
  store: RasterStore,
  document: RenderDocument,
): Promise<{ raster: Raster; rendered: boolean }> {
  const hit = await store.cached(documentDigest(document), renderer.identity);
  if (hit !== null) return { raster: hit, rendered: false };

  const raster = await renderer.render(document);
  await store.cache(raster);
  return { raster, rendered: true };
}

function pathFor(root: string, identity: Digest, key: BaselineKey): string {
  const name = key.label === undefined ? key.subject : `${key.subject}__${key.label}`;
  return join(root, identity, encodeURIComponent(name));
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
async function identities(root: string): Promise<readonly string[]> {
  const entries = await orAbsent(() => readdir(root, { withFileTypes: true }), root);
  if (entries === null) return [];
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function load(
  root: string,
  identity: string,
  key: BaselineKey,
): Promise<{ raster: Raster; identity: RenderIdentity } | null> {
  const raster = await readRaster(pathFor(root, identity, key));
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
 * *What it costs.* A genuinely corrupt pair now stops the run until a person
 * removes it, including in the render cache where a re-render would have been
 * enough. That is accepted rather than special-cased: a store with two rules
 * about which failures are survivable is a store whose behaviour depends on
 * which path found the damage. The message names both files so the removal is a
 * command, not an investigation.
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

/**
 * Reading a stored raster, shared by the disk and the wire.
 *
 * The two arrive by different routes and are the same value, so they are checked
 * by the same code. Two copies of this would be two ideas of what a baseline is,
 * and the one that drifts is the one that accepts a record the other refuses —
 * which acceptance 4 forbids, since where a baseline is kept must decide nothing
 * about what it means. Exported for `store-remote.ts`; not part of the package's
 * public surface.
 */
function sidecarFrom(value: unknown): Omit<Raster, 'bytes'> | null {
  const sidecar = recordFrom(value);
  if (sidecar === null) return null;

  const identity = identityFrom(sidecar.identity);
  const missingFonts = stringsFrom(sidecar.missingFonts);

  if (
    identity === null ||
    missingFonts === null ||
    typeof sidecar.documentDigest !== 'string' ||
    typeof sidecar.width !== 'number' ||
    typeof sidecar.height !== 'number'
  ) {
    return null;
  }

  return {
    documentDigest: sidecar.documentDigest,
    identity,
    width: sidecar.width,
    height: sidecar.height,
    missingFonts,
  };
}

/** As {@link sidecarFrom}, for a record that is expected to carry its bytes. */
export function rasterFrom(value: unknown): Raster | null {
  const sidecar = sidecarFrom(value);
  const bytes = recordFrom(value)?.bytes;

  return sidecar === null || typeof bytes !== 'string' ? null : { ...sidecar, bytes };
}

export function identityFrom(value: unknown): RenderIdentity | null {
  const identity = recordFrom(value);
  if (identity === null) return null;

  const fonts = stringsFrom(identity.fonts);
  if (
    fonts === null ||
    typeof identity.renderer !== 'string' ||
    typeof identity.engine !== 'string' ||
    typeof identity.platform !== 'string' ||
    typeof identity.deviceScaleFactor !== 'number'
  ) {
    return null;
  }

  return {
    renderer: identity.renderer,
    engine: identity.engine,
    platform: identity.platform,
    deviceScaleFactor: identity.deviceScaleFactor,
    fonts,
  };
}

function stringsFrom(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;

  const items: string[] = [];
  for (const item of value as readonly unknown[]) {
    if (typeof item !== 'string') return null;
    items.push(item);
  }
  return items;
}

export function recordFrom(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
