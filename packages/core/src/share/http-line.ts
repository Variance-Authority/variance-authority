/**
 * A line over HTTP: a bucket, a signed base, a tribunal deployment.
 *
 * The manifest is replaced with `If-Match` on the `ETag` it was read with, or
 * `If-None-Match: *` when there was none, which is the conditional write S3,
 * GCS, R2 and tribunal all honour. Blobs are addressed by digest and written
 * without a condition, first, so a manifest never names a blob that is not
 * there yet.
 */

import { linePath, type BlobPath, type LineCell, type ShareLine, type ShareMiss } from './line.js';

// Declared rather than imported, as elsewhere in this package: `core` takes no
// platform's types. Only the members used are named.
declare const fetch: (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
    signal?: unknown;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;
declare const AbortSignal: { timeout(ms: number): unknown };

/**
 * How long one request may take, its body included, when the options do not
 * say. A store that accepts a connection and never answers would otherwise
 * hold `ask`, `serve` and a publish open with nothing said.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

export interface HttpLineOptions {
  /** Base URL. Every path is appended to it, with exactly one `/` between. */
  readonly endpoint: string;
  /** Sent on every request: a bucket's `Authorization`, a deployment's token. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The verb a write uses. `PUT` for a bucket, `POST` for a deployment that routes on it. */
  readonly method?: 'PUT' | 'POST';
  /**
   * Milliseconds one request may take, from sending it to the last byte of its
   * body, before the store is `unreachable`. 60 000 when absent.
   */
  readonly timeoutMs?: number;
}

/**
 * `<endpoint>/<kind>/<name>/manifest.json`, the line's entries beside it, and
 * `<endpoint>/images/<digest>` shared by every line, so an image two lines name
 * is stored once.
 */
export function httpLineCell(options: HttpLineOptions): LineCell {
  const base = options.endpoint.replace(/\/+$/, '');
  const headers = options.headers ?? {};
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const where = (line: ShareLine, path: 'manifest.json' | BlobPath): string =>
    path.startsWith('images/') ? `${base}/${path}` : `${base}/${linePath(line)}/${path}`;

  // The signal is made per request and covers reading the body, so a store
  // that sends its headers and then stalls times out like one that never
  // answers at all.
  async function get(url: string): Promise<{ bytes: Uint8Array; etag: string | null } | ShareMiss> {
    try {
      const response = await fetch(url, { headers: { ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return missOf(url, response.status);
      return { bytes: new Uint8Array(await response.arrayBuffer()), etag: response.headers.get('etag') };
    } catch (error) {
      return thrown(url, error, timeoutMs);
    }
  }

  async function put(url: string, body: Uint8Array, condition: Record<string, string>): Promise<'written' | 'conflict' | ShareMiss> {
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(url, {
        method: options.method ?? 'PUT',
        headers: { 'content-type': 'application/octet-stream', ...headers, ...condition },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return thrown(url, error, timeoutMs);
    }
    if (response.ok) return 'written';
    if (response.status === 412 || response.status === 409) return 'conflict';
    return missOf(url, response.status);
  }

  return {
    async load(line) {
      const held = await get(where(line, 'manifest.json'));
      if (!('bytes' in held)) return held;
      // FIXME: a store that sends no ETag cannot be written conditionally, so
      // two publishers racing on it can lose an entry. The empty version makes
      // the next write unconditional rather than refused.
      return { manifest: held.bytes, version: held.etag ?? '' };
    },
    async blob(line, path) {
      const held = await get(where(line, path));
      return 'bytes' in held ? held.bytes : held;
    },
    async store(line, write) {
      // TODO: an entry or image no manifest names any more stays in the store;
      // nothing here deletes, and a bucket's lifecycle rule is the collector.
      for (const [path, bytes] of write.blobs) {
        const outcome = await put(where(line, path), bytes, {});
        if (outcome === 'conflict') {
          return { kind: 'unreachable', detail: `${path}: the store answered an unconditional write with a conflict` };
        }
        if (outcome !== 'written') return outcome;
      }
      const condition =
        write.expected === undefined
          ? { 'if-none-match': '*' }
          : write.expected === ''
            ? {}
            : { 'if-match': write.expected };
      return put(where(line, 'manifest.json'), write.manifest, condition);
    },
  };
}

/**
 * A request that threw, as the miss it is. A timeout says how long it waited;
 * anything else says the platform's message and, when it wraps one, the
 * reason underneath, which is where a refused connection or an unknown host
 * is named.
 */
function thrown(url: string, error: unknown, timeoutMs: number): ShareMiss {
  const failed = error as { readonly name?: unknown; readonly message?: unknown; readonly cause?: { readonly message?: unknown } };
  if (failed.name === 'TimeoutError') {
    return { kind: 'unreachable', detail: `${url}: timed out after ${String(timeoutMs / 1000)} s` };
  }
  const cause = typeof failed.cause?.message === 'string' ? `: ${failed.cause.message}` : '';
  return { kind: 'unreachable', detail: `${url}: ${String(failed.message)}${cause}` };
}

function missOf(url: string, status: number): ShareMiss {
  if (status === 404) return { kind: 'absent' };
  if (status === 401 || status === 403) return { kind: 'refused', detail: `${url}: HTTP ${String(status)}` };
  return { kind: 'unreachable', detail: `${url}: HTTP ${String(status)}` };
}
