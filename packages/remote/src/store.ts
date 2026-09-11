import {
  identityDigest,
  type Digest,
  type Raster,
  type RenderIdentity,
} from '@variance-authority/core/format';
import {
  RasterStoreError,
  REFUSAL,
  identityFrom,
  neverFails,
  rasterFrom,
  recordFrom,
  sidecarFrom,
  type BaselineKey,
  type Described,
  type Found,
  type RasterStore,
} from '@variance-authority/raster';
import { fetchWithin } from './transport.js';

/**
 * Baselines behind an HTTP endpoint the operator runs.
 *
 * The alternative to git-LFS, for a team that will not put images in the
 * repository — a large monorepo where every clone would pay for every subject's
 * history, or an organisation whose artifacts live in object storage by policy.
 * It buys that at the cost of a service that has to be up, which is the trade
 * this file is arranged around.
 *
 * The protocol is deliberately dull, and dull the same way `connectRenderer`
 * is: a `Raster` already carries its bytes as base64 so that it survives exactly
 * these hops, so the transport is `JSON.stringify` and there is no encoding
 * question to get wrong twice.
 *
 * | route | body | answer |
 * |---|---|---|
 * | `POST /baseline/find` | `{ key, identity }` | `{ found: Found \| null }` |
 * | `POST /baseline/describe` | `{ key, identity }` | `{ described: Described \| null }` |
 * | `POST /baseline/put` | `{ key, raster }` | `{ ok: true }` |
 * | `POST /cache/find` | `{ digest, identity }` | `{ raster: Raster \| null }` |
 * | `POST /cache/put` | `{ raster }` | `{ ok: true }` |
 *
 * `describe` earns its own route rather than a query parameter on `find`,
 * because the saving is the response body. A hop is where an unnecessary image
 * is most expensive — serialized, sent, parsed, and held — and a route that can
 * answer either way is a route whose cost is decided by a flag somebody can
 * forget.
 *
 * ## The one rule
 *
 * **A store failure is never a verdict.** An unreachable endpoint, a 500, a 401,
 * a body that cannot be read as an answer — every one of them throws
 * {@link RasterStoreError}, and none of them ever produces `null`. `null` is
 * reserved for a server that positively said "no baseline for this key".
 *
 * The failure mode being refused is specific and unrecoverable. `find` returning
 * `null` makes the verdict `new`; `new` means the caller records what is on
 * screen as the baseline; and the baseline it overwrites was the only copy of
 * what the subject looked like before. A network blip would therefore not merely
 * skip a check, it would destroy the thing the check was against, and it would do
 * it while reporting success. Every parse below exists to make that impossible,
 * which is why an unrecognised body is an error rather than a shrug.
 *
 * The identity partition is the backing store's, not this one's. What crosses the
 * wire is the same `RenderIdentity` a local lookup would use, so a server backed
 * by `createDurableStore` answers `comparable: false` for another machine's
 * baseline for exactly the reasons ADR-0011 gives, and this client neither adds
 * nor is able to remove that.
 */

export const BASELINE_FIND_PATH = '/baseline/find';
export const BASELINE_WORKING_SET_PATH = '/baseline/working-set';
export const BASELINE_DESCRIBE_PATH = '/baseline/describe';
export const BASELINE_PUT_PATH = '/baseline/put';
export const CACHE_FIND_PATH = '/cache/find';
export const CACHE_PUT_PATH = '/cache/put';

const DEFAULT_TIMEOUT_MS = 30_000;

/** Longest server message quoted back before it is summarised rather than dropped. */
const QUOTE_LIMIT = 500;

export interface RemoteStoreOptions {
  /** Base URL of a server started by {@link serveRasterStore}, e.g. `http://box:7788`. */
  readonly endpoint: string;
  /** Bearer token the operator set on the service. */
  readonly token?: string;
  /** Milliseconds. A store that hangs must fail, not stall the run. */
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * What is prefetched is a description, never an image.
 *
 * `RasterStore.expect` is the contract; this is the store the contract was
 * written for. `find` still goes to the endpoint for every subject whose
 * document moved, because that is the subject whose bytes are actually needed
 * and nothing is saved by fetching the ones that were not.
 *
 * *What it costs.* The descriptions are read once, at the start. A store another
 * job writes to mid-run is therefore answered from before that write — already
 * true of a run that read a subject before the write landed, and why approval is
 * a recorded decision rather than a race.
 */

/**
 * A durable store that is somewhere else.
 *
 * Synchronous construction, unlike `connectRenderer`, and the asymmetry is
 * deliberate: a renderer has an identity that must be learned before anything can
 * be trusted, whereas a store has none of its own — the identity in play belongs
 * to the renderer and is carried on every call. There is nothing to hand-shake
 * about, and a constructor that pinged the endpoint would only move the failure
 * earlier without changing what it means.
 */
export function createRemoteStore(options: RemoteStoreOptions): RasterStore {
  let declared: readonly BaselineKey[] | undefined;
  // Keyed by identity digest, because the same key described under two identities
  // is two answers and the second is `comparable: false`. One in-flight promise
  // per identity, so the concurrency the run is built on does not turn one
  // prefetch into as many as there are workers.
  const fetched = new Map<string, Promise<ReadonlyMap<string, Described | null> | null>>();

  async function prefetched(identity: RenderIdentity): Promise<ReadonlyMap<string, Described | null> | null> {
    if (declared === undefined) return null;
    const under = identityDigest(identity);
    let pending = fetched.get(under);
    if (pending === undefined) {
      pending = workingSet(options, declared, identity);
      fetched.set(under, pending);
    }
    return pending;
  }

  return {
    retention: 'durable',

    expect(keys: readonly BaselineKey[]): void {
      declared = keys;
      // A second declaration replaces the first and discards what was fetched for
      // it, rather than answering the new set from the old set's misses.
      fetched.clear();
    },

    async find(key: BaselineKey, identity: RenderIdentity): Promise<Found | null> {
      return readFound(await call(options, BASELINE_FIND_PATH, { key, identity }), options.endpoint);
    },

    async describe(key: BaselineKey, identity: RenderIdentity): Promise<Described | null> {
      const set = await prefetched(identity);
      // `has` rather than a truthy check: the prefetch answers `null` for a
      // subject with no baseline, and that is an answer. Falling through to the
      // endpoint for it would spend one round trip per new subject, which on a
      // first run is every subject in the suite.
      if (set !== null && set.has(keyOf(key))) return set.get(keyOf(key)) ?? null;

      return readDescribed(
        await call(options, BASELINE_DESCRIBE_PATH, { key, identity }),
        options.endpoint,
      );
    },

    async put(key: BaselineKey, raster: Raster): Promise<void> {
      await call(options, BASELINE_PUT_PATH, { key, raster });
    },

    // This used to throw, and the comment that stood here argued for it while
    // conceding the case against: *"the cache path throws on failure too, though
    // a cache miss costs only a re-render"*. It reasoned that answering "miss"
    // to an outage would turn a broken endpoint into a run that is merely slow.
    // It would — and a run that is merely slow is the correct outcome, because
    // the endpoint being down changes nothing about what any verdict should be.
    // The baseline half of this store still refuses out loud, which is where an
    // outage does change a verdict and therefore has to stop the run.
    //
    // The malformed-body checks stay inside the wrapper on purpose. A server
    // answering nonsense is still a miss to this caller, and losing the shape
    // check would let a `{ raster: 3 }` through as an image.
    renderCache: neverFails({
      async get(digest: Digest, identity: RenderIdentity): Promise<Raster | null> {
        const body = recordFrom(await call(options, CACHE_FIND_PATH, { digest, identity }));
        if (body === null || !('raster' in body)) {
          throw malformed(options.endpoint, CACHE_FIND_PATH, 'no `raster` field');
        }
        if (body.raster === null) return null;

        const raster = rasterFrom(body.raster);
        if (raster === null) {
          throw malformed(options.endpoint, CACHE_FIND_PATH, 'a `raster` that is not a raster');
        }
        return raster;
      },

      async put(raster: Raster): Promise<void> {
        await call(options, CACHE_PUT_PATH, { raster });
      },
    }),
  };
}

/** One string per `(subject, label)`, so a `Map` can answer what a lookup asks. */
function keyOf(key: BaselineKey): string {
  return `${key.subject}\u0000${key.label ?? ''}`;
}

/**
 * Fetch every declared description in one request, or decide there is no such path.
 *
 * `null` means *ask per key from now on*, and it is returned for exactly one
 * condition: a server that has no route for this path. Every other failure is a
 * failure — an unreachable endpoint, a 500, a body that will not parse — because
 * a prefetch that swallowed those would answer `no baseline` for three hundred
 * subjects and record the entire suite as `new`.
 *
 * The 404 case is not a swallow of the same shape. A store served by a version
 * of `serveRasterStore` from before this path existed still answers every
 * `describe` correctly one at a time, so degrading to that is slower and not
 * different — and it is what lets this be added to the protocol without making
 * every deployed server a broken one.
 */
async function workingSet(
  options: RemoteStoreOptions,
  keys: readonly BaselineKey[],
  identity: RenderIdentity,
): Promise<ReadonlyMap<string, Described | null> | null> {
  let payload: unknown;
  try {
    payload = await call(options, BASELINE_WORKING_SET_PATH, { keys, identity });
  } catch (error) {
    if (error instanceof RasterStoreError && /returned 404/.test(error.message)) return null;
    throw error;
  }

  const body = recordFrom(payload);
  if (body === null || !Array.isArray(body.entries)) {
    throw malformed(options.endpoint, BASELINE_WORKING_SET_PATH, 'no `entries` array');
  }

  const described = new Map<string, Described | null>();
  for (const entry of body.entries) {
    const record = recordFrom(entry);
    const key = record === null ? null : recordFrom(record.key);
    if (key === null || typeof key.subject !== 'string') {
      throw malformed(options.endpoint, BASELINE_WORKING_SET_PATH, 'an entry with no `key`');
    }
    described.set(
      keyOf({ subject: key.subject, ...(typeof key.label === 'string' ? { label: key.label } : {}) }),
      readDescribed(record, options.endpoint),
    );
  }
  return described;
}

/**
 * One request, and every way it can fail turned into one kind of error.
 *
 * Including the ones `fetch` reports by rejecting — DNS, refused connection,
 * abort — which arrive as a `TypeError` whose message is "fetch failed" and says
 * nothing about which endpoint or why. The original is kept as `cause`; what is
 * added is the sentence the operator needs and the consequence that was avoided.
 */
async function call(
  options: RemoteStoreOptions,
  path: string,
  body: unknown,
): Promise<unknown> {
  const get = options.fetch ?? globalThis.fetch;
  const url = `${options.endpoint}${path}`;
  try {
    const response = await fetchWithin(
      get,
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
        },
        body: JSON.stringify(body),
      },
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new RasterStoreError(
        `baseline store ${url} returned ${response.status}: ${quote(await safeText(response))}. ` +
          REFUSAL,
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new RasterStoreError(
        `baseline store ${url} returned a body that is not JSON. ${REFUSAL}`,
        { cause: error },
      );
    }
  } catch (error) {
    if (error instanceof RasterStoreError) throw error;
    throw new RasterStoreError(
      `baseline store ${url} is unreachable: ${error instanceof Error ? error.message : String(error)}. ` +
        REFUSAL,
      { cause: error },
    );
  }
}

/**
 * A miss is something the server *said*, never something that failed to arrive.
 *
 * So the field must be present and must be exactly `null`. An empty body, an
 * error page that happens to parse, a future version answering under a different
 * name — all of them are absences of an answer, and the only safe reading of an
 * absent answer is that the run cannot continue.
 */
function readFound(payload: unknown, endpoint: string): Found | null {
  const body = recordFrom(payload);
  if (body === null || !('found' in body)) {
    throw malformed(endpoint, BASELINE_FIND_PATH, 'no `found` field');
  }
  if (body.found === null) return null;

  const found = recordFrom(body.found);
  const raster = found === null ? null : rasterFrom(found.raster);
  const storedUnder = found === null ? null : identityFrom(found.storedUnder);

  if (found === null || raster === null || storedUnder === null) {
    throw malformed(endpoint, BASELINE_FIND_PATH, 'a `found` that is not a baseline');
  }
  if (typeof found.comparable !== 'boolean') {
    // Never defaulted. Guessing `true` compares two machines; guessing `false`
    // reports every subject incomparable. Both are verdicts invented by a parser.
    throw malformed(endpoint, BASELINE_FIND_PATH, '`comparable` missing or not a boolean');
  }

  return { raster, comparable: found.comparable, storedUnder };
}

/**
 * The cheap answer, held to the same standard as the expensive one.
 *
 * A description decides whether a subject is compared at all, so a body this
 * client is willing to guess at is a body that can settle a run to `unchanged`
 * on nothing. `documentDigest` in particular: absent, it would compare
 * `undefined` against a real digest, which never matches — a lookup that
 * silently degrades into "always render" and hides a broken server behind a
 * bill for images.
 */
function readDescribed(payload: unknown, endpoint: string): Described | null {
  const body = recordFrom(payload);
  if (body === null || !('described' in body)) {
    throw malformed(endpoint, BASELINE_DESCRIBE_PATH, 'no `described` field');
  }
  if (body.described === null) return null;

  const described = recordFrom(body.described);
  const storedUnder = described === null ? null : identityFrom(described.storedUnder);

  if (described === null || storedUnder === null) {
    throw malformed(endpoint, BASELINE_DESCRIBE_PATH, 'a `described` that is not a baseline');
  }
  if (typeof described.documentDigest !== 'string') {
    throw malformed(
      endpoint,
      BASELINE_DESCRIBE_PATH,
      '`documentDigest` missing or not a string',
    );
  }
  if (typeof described.comparable !== 'boolean') {
    throw malformed(endpoint, BASELINE_DESCRIBE_PATH, '`comparable` missing or not a boolean');
  }

  // Refused rather than defaulted to `[]`, and this is the one field here where
  // that distinction changes a verdict. A settled subject reports `unchanged`;
  // if the baseline was painted without a declared font, it must say so in the
  // same sentence. A wire that drops the field and a wire that says "no fonts
  // were missing" are indistinguishable after a default, and the second is the
  // one that gets believed — which is the `stabilization` failure, in the codec
  // that produced it the first time.
  const missingFonts = stringsFrom(described.missingFonts);
  if (missingFonts === null) {
    throw malformed(
      endpoint,
      BASELINE_DESCRIBE_PATH,
      '`missingFonts` missing or not an array of strings',
    );
  }

  // Dropped rather than refused when it will not parse, unlike every field
  // above. Those decide a verdict; this decides only whether a subject is worth
  // *collecting*, and the fallback of a missing list is to collect it — the safe
  // direction, and the one every run took before selection existed.
  const components = stringsFrom(described.components);

  // Dropped rather than refused, on the same reasoning as `components` and with
  // the opposite safe direction: the fallback of a missing list is *this run
  // cannot say when the defect arrived*, which is what a reader is told when no
  // baseline recorded one. Refusing here would fail a run over a sentence.
  const findingMarks = stringsFrom(described.findingMarks);
  const accessibilitySidecar =
    described.accessibility === undefined
      ? undefined
      : sidecarFrom({
          documentDigest: described.documentDigest,
          identity: storedUnder,
          width: 0,
          height: 0,
          missingFonts,
          accessibility: described.accessibility,
        });
  if (described.accessibility !== undefined && accessibilitySidecar === null) {
    throw malformed(endpoint, BASELINE_DESCRIBE_PATH, 'a malformed `accessibility` snapshot');
  }

  return {
    ...(components !== null ? { components } : {}),
    ...(findingMarks !== null ? { findingMarks } : {}),
    documentDigest: described.documentDigest,
    comparable: described.comparable,
    storedUnder,
    missingFonts,
    ...(accessibilitySidecar?.accessibility === undefined
      ? {}
      : { accessibility: accessibilitySidecar.accessibility }),
  };
}

/** An array of strings, or `null` for anything else — including absent. */
function stringsFrom(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === 'string') ? (value as readonly string[]) : null;
}

function malformed(endpoint: string, path: string, what: string): RasterStoreError {
  return new RasterStoreError(
    `baseline store ${endpoint}${path} answered with ${what}. ${REFUSAL}`,
  );
}

/**
 * Validation, on the client and not on the server.
 *
 * The asymmetry is the point rather than an omission. A server that mis-reads a
 * request produces a 500, which this client reports as a failure and nobody
 * mistakes for an answer. A client that mis-reads a *response* produces a
 * verdict. Only one of those directions can lie, so only one is checked field by
 * field, and each value is rebuilt from checked parts rather than cast into
 * shape — a cast is a claim about data that arrived over a network from software
 * this package does not version.
 *
 * The field-by-field readers themselves live in `store.ts`, with the interface
 * they check against, because a sidecar read off a disk and a body read off a
 * socket are the same value arriving by different routes. Two copies would be
 * two ideas of what a baseline is, and the drift would show up as a store that
 * accepts what another refuses.
 */

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<body could not be read>';
  }
}

/** Quoted in full up to a limit, and the limit is stated rather than hidden. */
function quote(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= QUOTE_LIMIT
    ? trimmed
    : `${trimmed.slice(0, QUOTE_LIMIT)}… (+${trimmed.length - QUOTE_LIMIT} more characters)`;
}

// The `./store` entrypoint is one protocol, whichever end a caller needs.
export { serveRasterStore } from './serve-store.js';
export type { ServeStoreOptions, StoreServer } from './serve-store.js';
