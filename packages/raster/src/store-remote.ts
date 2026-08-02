import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Digest, Raster, RenderIdentity } from '@variance-authority/core';
import type { BaselineKey, Found, RasterStore } from './store.js';

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
 * | `POST /baseline/put` | `{ key, raster }` | `{ ok: true }` |
 * | `POST /cache/find` | `{ digest, identity }` | `{ raster: Raster \| null }` |
 * | `POST /cache/put` | `{ raster }` | `{ ok: true }` |
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
export const BASELINE_PUT_PATH = '/baseline/put';
export const CACHE_FIND_PATH = '/cache/find';
export const CACHE_PUT_PATH = '/cache/put';

const DEFAULT_TIMEOUT_MS = 30_000;

/** Longest server message quoted back before it is summarised rather than dropped. */
const QUOTE_LIMIT = 500;

/**
 * Something went wrong with the *store*, as distinct from something being true
 * about the subject.
 *
 * A distinct type because the caller has to distinguish them and a message
 * cannot be matched on. Spec 0003 gives operator error its own exit code
 * precisely so a CI job can tell "this needs review" from "this did not run",
 * and a verdict and a crash sharing a code is the thing that makes a red build
 * uninformative.
 */
export class RasterStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RasterStoreError';
  }
}

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
  return {
    retention: 'durable',

    async find(key: BaselineKey, identity: RenderIdentity): Promise<Found | null> {
      return readFound(await call(options, BASELINE_FIND_PATH, { key, identity }), options.endpoint);
    },

    async put(key: BaselineKey, raster: Raster): Promise<void> {
      await call(options, BASELINE_PUT_PATH, { key, raster });
    },

    async cached(digest: Digest, identity: RenderIdentity): Promise<Raster | null> {
      // The cache path throws on failure too, though a cache miss costs only a
      // re-render. A store that answered "miss" to an outage would turn a broken
      // endpoint into a run that is merely slow, and the operator would find out
      // when `put` finally failed — after the renders had been paid for.
      const body = record(await call(options, CACHE_FIND_PATH, { digest, identity }));
      if (body === null || !('raster' in body)) {
        throw malformed(options.endpoint, CACHE_FIND_PATH, 'no `raster` field');
      }
      if (body.raster === null) return null;

      const raster = readRaster(body.raster);
      if (raster === null) {
        throw malformed(options.endpoint, CACHE_FIND_PATH, 'a `raster` that is not a raster');
      }
      return raster;
    },

    async cache(raster: Raster): Promise<void> {
      await call(options, CACHE_PUT_PATH, { raster });
    },
  };
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await get(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new RasterStoreError(
        `baseline store ${url} returned ${response.status}: ${quote(await safeText(response))}. ` +
          refusal,
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new RasterStoreError(
        `baseline store ${url} returned a body that is not JSON. ${refusal}`,
        { cause: error },
      );
    }
  } catch (error) {
    if (error instanceof RasterStoreError) throw error;
    throw new RasterStoreError(
      `baseline store ${url} is unreachable: ${error instanceof Error ? error.message : String(error)}. ` +
        refusal,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }
}

const refusal =
  'This is an operator error, not a verdict: reporting it as a missing baseline would ' +
  'record whatever is on screen and overwrite the baseline this run was meant to compare ' +
  'against';

/**
 * A miss is something the server *said*, never something that failed to arrive.
 *
 * So the field must be present and must be exactly `null`. An empty body, an
 * error page that happens to parse, a future version answering under a different
 * name — all of them are absences of an answer, and the only safe reading of an
 * absent answer is that the run cannot continue.
 */
function readFound(payload: unknown, endpoint: string): Found | null {
  const body = record(payload);
  if (body === null || !('found' in body)) {
    throw malformed(endpoint, BASELINE_FIND_PATH, 'no `found` field');
  }
  if (body.found === null) return null;

  const found = record(body.found);
  const raster = found === null ? null : readRaster(found.raster);
  const storedUnder = found === null ? null : readIdentity(found.storedUnder);

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

function malformed(endpoint: string, path: string, what: string): RasterStoreError {
  return new RasterStoreError(
    `baseline store ${endpoint}${path} answered with ${what}. ${refusal}`,
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
 */
function readRaster(value: unknown): Raster | null {
  const raster = record(value);
  if (raster === null) return null;

  const identity = readIdentity(raster.identity);
  const missingFonts = readStrings(raster.missingFonts);

  if (
    identity === null ||
    missingFonts === null ||
    typeof raster.documentDigest !== 'string' ||
    typeof raster.bytes !== 'string' ||
    typeof raster.width !== 'number' ||
    typeof raster.height !== 'number'
  ) {
    return null;
  }

  return {
    documentDigest: raster.documentDigest,
    identity,
    width: raster.width,
    height: raster.height,
    bytes: raster.bytes,
    missingFonts,
  };
}

function readIdentity(value: unknown): RenderIdentity | null {
  const identity = record(value);
  if (identity === null) return null;

  const fonts = readStrings(identity.fonts);
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

function readStrings(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;

  const items: string[] = [];
  for (const item of value as readonly unknown[]) {
    if (typeof item !== 'string') return null;
    items.push(item);
  }
  return items;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

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

export interface ServeStoreOptions {
  /** `0`, the default, binds a free port and reports it on {@link StoreServer.url}. */
  readonly port?: number;
  /**
   * Bearer token required on every request.
   *
   * Absent means the socket is the only gate, which is a decision for the
   * operator's network rather than a default this package can make for them.
   */
  readonly token?: string;
}

export interface StoreServer {
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Expose a store over HTTP.
 *
 * Thin for the same reason `serveRenderer` is: it owns no storage, so the
 * local and remote paths cannot drift into two implementations that disagree
 * about where a baseline lives or which identity wrote it. Wrapping the durable
 * store is what makes "remote" mean the same thing as "durable, further away" —
 * and it is what lets the client be tested against a real socket instead of
 * against a mock that agrees with it by construction.
 */
export async function serveRasterStore(
  store: RasterStore,
  options: ServeStoreOptions = {},
): Promise<StoreServer> {
  const server = createServer((request_, response) => {
    void handle(store, options, request_, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new RasterStoreError('baseline store server did not bind a TCP port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

async function handle(
  store: RasterStore,
  options: ServeStoreOptions,
  request_: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    if (options.token !== undefined && request_.headers.authorization !== `Bearer ${options.token}`) {
      send(response, 401, { error: 'missing or wrong bearer token' });
      return;
    }

    if (request_.method !== 'POST') {
      send(response, 405, { error: `only POST is served; got ${request_.method ?? '?'}` });
      return;
    }

    const body = record(JSON.parse(await readBody(request_)));
    if (body === null) {
      send(response, 400, { error: 'body is not a JSON object' });
      return;
    }

    switch (request_.url) {
      case BASELINE_FIND_PATH: {
        const found = await store.find(body.key as BaselineKey, body.identity as RenderIdentity);
        send(response, 200, { found });
        return;
      }
      case BASELINE_PUT_PATH: {
        await store.put(body.key as BaselineKey, body.raster as Raster);
        send(response, 200, { ok: true });
        return;
      }
      case CACHE_FIND_PATH: {
        const raster = await store.cached(body.digest as Digest, body.identity as RenderIdentity);
        send(response, 200, { raster });
        return;
      }
      case CACHE_PUT_PATH: {
        await store.cache(body.raster as Raster);
        send(response, 200, { ok: true });
        return;
      }
      default:
        send(response, 404, { error: `no route for POST ${request_.url ?? '?'}` });
        return;
    }
  } catch (error) {
    // A failed lookup is a 500 and never `{ found: null }`. The client is built
    // to treat any non-2xx as an operator error, and that arrangement only works
    // if the server never dresses a failure up as an answer.
    send(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function readBody(request_: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request_) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
