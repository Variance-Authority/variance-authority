import {
  identityDigest,
  type ComponentHash,
  type Digest,
  type Raster,
  type RenderIdentity,
} from '@variance-authority/core';

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
 * cannot be matched on. ADR-0017 gives operator error its own exit code
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
 * Exactly the four fields that decide whether an image is needed at all, and
 * what may be said once it is not. There is no `raster` here and there must not
 * be one: the moment this type can carry bytes, a caller can be handed them by
 * accident and the saving disappears.
 */
export interface Described {
  /** The digest of the document the stored image was painted from. */
  readonly documentDigest: Digest;
  /** As {@link Found.comparable} — whether the identity now asking wrote it. */
  readonly comparable: boolean;
  readonly storedUnder: RenderIdentity;

  /**
   * Fonts the renderer did not have when the baseline was painted.
   *
   * The fourth field, and the one that makes this type usable for a verdict at
   * all. Without it a caller settling from a digest match reports a bare
   * `unchanged` for a baseline that is an image of a substituted font — true
   * about the pixels, and a lie about the subject. Every backend already reads
   * this out of the sidecar and used to drop it here, which is why `settle` took
   * the expensive `Found` for its first several months.
   *
   * Empty is the answer, never absent. A transport that omits it must fail
   * rather than default: a missing verdict-bearing field silently read as `[]`
   * is how `stabilization` once made every subject `incomparable` forever.
   */
  readonly missingFonts: readonly string[];

  /**
   * Component names the document that painted this baseline rendered (ADR-0018).
   *
   * The field that lets a run decide *what not to observe*. A subject whose
   * baseline names none of the components an edit touched cannot have been
   * changed by that edit, so it need not be collected at all — which is the whole
   * of `--since` (`docs/selecting.md`).
   *
   * Names rather than hashes, deliberately. A hash here would invite a caller to
   * compare it against this run's and skip the comparison, which is `settle`'s
   * job and is decided on the *document* digest; a name list can only answer
   * membership, which is the only question selection is allowed to ask.
   *
   * **Absent means unknown, never none.** A baseline written before ADR-0027, or
   * by a profile that produced no snapshot, has no list — and a selector that
   * read that as "renders nothing" would skip a subject on the strength of a
   * missing field.
   */
  readonly components?: readonly string[];
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

  /**
   * Images this machine has already painted. See {@link RenderCache}.
   *
   * A property rather than two methods, because it is a different object with a
   * different contract that happens to be reachable from here. Every backend
   * supplies its own today; the day one is configured separately, this is the
   * field that changes and nothing else does.
   */
  readonly renderCache: RenderCache;
}

/**
 * Rasters already painted, keyed by the digest of the document that produced
 * them — the deferral lever, as an interface.
 *
 * ## Why this is not part of `RasterStore`
 *
 * It was, and the two have **opposite loss semantics**, which is the whole of
 * the argument. Losing a baseline is fatal: the thing this run was meant to
 * compare against is gone, and reporting that as "no baseline" would record
 * whatever is on screen and overwrite it — so every failure must throw
 * ({@link RasterStoreError}, {@link REFUSAL}). Losing a cache entry costs one
 * render. Welded together, the cache inherits the baseline's paranoia, and a
 * backend then writes what the remote store used to: *"the cache path throws on
 * failure too, though a cache miss costs only a re-render"* — a red build for a
 * condition that is not about anybody's code.
 *
 * ## The rule
 *
 * > **A `RenderCache` never throws.**
 *
 * `get` answers `null` for a miss, for an outage, for a permission error, for a
 * corrupt entry, and for a response nobody can parse. `put` resolves whether or
 * not anything was written. There is no failure a caller could usefully
 * distinguish, because the response to every one of them is identical: paint it.
 *
 * *What that costs, stated rather than hidden.* A cache that is failing is
 * indistinguishable from a cache that is cold, so a broken cache makes a run
 * slow and never makes it red, and nobody is told. That is deliberate — the
 * alternative is failing a build over an optimisation — but it does mean an
 * operator watching CI get slower has to go looking. The place a warning would
 * belong is a run's `warnings` array, and nothing puts one there yet.
 *
 * Correctness never rests on this. An entry is addressed by the digest of the
 * document that painted it under the identity that painted it, so a hit is an
 * image of exactly this document on exactly this machine. A wrong location, a
 * stale entry or a cache shared between projects can cost a render and cannot
 * produce a wrong image.
 */
export interface RenderCache {
  get(digest: Digest, identity: RenderIdentity): Promise<Raster | null>;
  put(raster: Raster): Promise<void>;
}

/**
 * Hold an implementation to {@link RenderCache}'s rule.
 *
 * Backends build their cache out of a disk, a socket or a bucket, all of which
 * throw, and every one of them would otherwise have to remember not to. Wrapping
 * at construction makes the rule a property of the value rather than a promise
 * in a comment — and the parity suite checks each backend survives its own cache
 * being broken, because a backend that forgot this wrapper still type-checks.
 */
export function neverFails(cache: RenderCache): RenderCache {
  return {
    async get(digest, identity): Promise<Raster | null> {
      try {
        return await cache.get(digest, identity);
      } catch {
        // A miss and a failure are the same instruction. Swallowed rather than
        // rethrown as a softer error, because there is no caller that would do
        // anything different with one.
        return null;
      }
    },
    async put(raster): Promise<void> {
      try {
        await cache.put(raster);
      } catch {
        // The image is already in hand; failing to keep a copy of it changes
        // nothing about this run and costs the next one a render.
      }
    },
  };
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
    // Wrapped even though a `Map` cannot fail, so that the rule is visible at
    // every construction site rather than at the ones that happen to need it.
    renderCache: neverFails({
      async get(digest, identity): Promise<Raster | null> {
        return cache.get(`${digest}/${identityDigest(identity)}`) ?? null;
      },
      async put(raster): Promise<void> {
        cache.set(`${raster.documentDigest}/${identityDigest(raster.identity)}`, raster);
      },
    }),
  };
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

  const components = componentsFrom(sidecar.components);

  return {
    documentDigest: sidecar.documentDigest,
    identity,
    width: sidecar.width,
    height: sidecar.height,
    missingFonts,
    ...(components !== undefined ? { components } : {}),
  };
}

/**
 * Component hashes off a wire, or `undefined`.
 *
 * The one field on a sidecar that is dropped rather than refused when it will not
 * parse, and the asymmetry is deliberate. Every other field decides a *verdict* —
 * a missing identity cannot be partitioned, a missing digest can never settle —
 * so a malformed one has to be loud. These decide an *ordering*: without them a
 * run ranks regions by area, which is what every run did before they existed.
 * Failing a build over the field that makes a correct report better-ordered would
 * trade a working comparison for a tidy one.
 *
 * Absent means *unknown*, never *no components*, and nothing downstream may read
 * an empty array out of a missing field.
 */
function componentsFrom(value: unknown): readonly ComponentHash[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const parsed: ComponentHash[] = [];
  for (const entry of value) {
    const row = recordFrom(entry);
    if (
      row === null ||
      typeof row['component'] !== 'string' ||
      typeof row['instances'] !== 'number' ||
      typeof row['structure'] !== 'string' ||
      typeof row['semantics'] !== 'string' ||
      typeof row['text'] !== 'string' ||
      typeof row['style'] !== 'string'
    ) {
      // A sidecar written before the band split carries `structure` and no
      // `semantics` — and the whole array is refused rather than back-filled,
      // because the old `structure` digest covered the accessible name and the
      // text too. Reading it as the new, narrower `structure` would report a
      // renamed heading as a shape change and a reworded paragraph as one, both
      // of which are the bands a sensitivity level exists to tell apart.
      return undefined;
    }

    parsed.push({
      component: row['component'],
      instances: row['instances'],
      structure: row['structure'],
      semantics: row['semantics'],
      text: row['text'],
      style: row['style'],
      ...(typeof row['geometry'] === 'string' ? { geometry: row['geometry'] } : {}),
    });
  }

  return parsed;
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
  const rasterization = identity.rasterization;

  if (
    fonts === null ||
    typeof identity.renderer !== 'string' ||
    typeof identity.engine !== 'string' ||
    typeof identity.platform !== 'string' ||
    typeof identity.deviceScaleFactor !== 'number' ||
    // Absent is allowed — a renderer may predate the field — but a present value
    // of the wrong type is refused rather than dropped, because dropping it is
    // exactly the failure above.
    (stabilization !== undefined && typeof stabilization !== 'string') ||
    (rasterization !== undefined && typeof rasterization !== 'string')
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
    ...(rasterization !== undefined ? { rasterization } : {}),
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
