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
 *
 * **What is in this file is what needs nothing.** The contract, the error, the
 * in-memory store, and the checks that turn an untrusted record into a `Raster`.
 * A disk-backed store is `@variance-authority/store`; a store across a hop is
 * `@variance-authority/remote`. The ephemeral mode's argument — no container, no
 * pinned runner, no stored artifact — is now also a fact about the package graph:
 * running that way pulls in no filesystem and no socket.
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
 * Declared here, beside the interface, rather than with the backend that first
 * needed it. Every backend has to be able to fail without being heard as an
 * answer — a disk says EACCES where a socket says 500 — and an error type owned
 * by one transport invites the others to invent their own, which is how `run.ts`
 * would end up with a list of failures to recognise instead of one.
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

/**
 * Reading a stored raster, shared by the disk and the wire.
 *
 * The two arrive by different routes and are the same value, so they are checked
 * by the same code. Two copies of this would be two ideas of what a baseline is,
 * and the one that drifts is the one that accepts a record the other refuses —
 * which acceptance 4 forbids, since where a baseline is kept must decide nothing
 * about what it means. That is the whole reason these checks sit in the package
 * neither backend owns.
 */
export function sidecarFrom(value: unknown): Omit<Raster, 'bytes'> | null {
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

/**
 * An identity off a wire, rebuilt field by field.
 *
 * **Every field of `RenderIdentity` must appear here, including the optional
 * ones.** This function is on the path of every baseline sidecar, every remote
 * store response and every render-cache read-back, so a field it forgets is a
 * field that survives being written and is gone by the time anything compares
 * it — and `identityDigest` covers all of them.
 *
 * That is not hypothetical. `stabilization` was missing from this list, and the
 * consequence was that a durable workflow could never see its own baseline:
 * `run` rendered under an identity carrying the recipe digest, the raster went
 * through this codec on the way to the candidate sidecar and came back without
 * it, `accept` stored the baseline under the shortened digest, and the next
 * `run` looked up under the full one — found a baseline under a *sibling*
 * identity, and reported `incomparable` in a sentence that named the same
 * machine on both sides. Every run, forever, with no way to act on it.
 *
 * It survived every test because no test ever crossed the codec with a
 * stabilizing renderer: the store suites build identities by hand, and the run
 * suite injects a fake renderer that stamps none. It was found by the first real
 * `run` → `accept` → `run`.
 */
export function identityFrom(value: unknown): RenderIdentity | null {
  const identity = recordFrom(value);
  if (identity === null) return null;

  const fonts = stringsFrom(identity.fonts);
  const stabilization = identity.stabilization;

  if (
    fonts === null ||
    typeof identity.renderer !== 'string' ||
    typeof identity.engine !== 'string' ||
    typeof identity.platform !== 'string' ||
    typeof identity.deviceScaleFactor !== 'number' ||
    // Absent is allowed — a renderer may predate the field — but a present value
    // of the wrong type is refused rather than dropped, because dropping it is
    // exactly the failure above.
    (stabilization !== undefined && typeof stabilization !== 'string')
  ) {
    return null;
  }

  return {
    renderer: identity.renderer,
    engine: identity.engine,
    platform: identity.platform,
    deviceScaleFactor: identity.deviceScaleFactor,
    fonts,
    ...(stabilization !== undefined ? { stabilization } : {}),
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

/** An error's text, however it was thrown. Shared so every backend words it alike. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
