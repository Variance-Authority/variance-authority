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

// Declared rather than imported, as in `index.ts`: `core` takes no platform's
// types. Only the members used are named.
declare const fetch: (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface HttpLineOptions {
  /** Base URL. Every path is appended to it, with exactly one `/` between. */
  readonly endpoint: string;
  /** Sent on every request: a bucket's `Authorization`, a deployment's token. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The verb a write uses. `PUT` for a bucket, `POST` for a deployment that routes on it. */
  readonly method?: 'PUT' | 'POST';
}

/**
 * `<endpoint>/<kind>/<name>/manifest.json`, the line's entries beside it, and
 * `<endpoint>/images/<digest>` shared by every line, so an image two lines name
 * is stored once.
 */
export function httpLineCell(options: HttpLineOptions): LineCell {
  const base = options.endpoint.replace(/\/+$/, '');
  const headers = options.headers ?? {};
  const where = (line: ShareLine, path: 'manifest.json' | BlobPath): string =>
    path.startsWith('images/') ? `${base}/${path}` : `${base}/${linePath(line)}/${path}`;

  async function get(url: string): Promise<{ bytes: Uint8Array; etag: string | null } | ShareMiss> {
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(url, { headers: { ...headers } });
    } catch (error) {
      return { kind: 'unreachable', detail: `${url}: ${(error as Error).message}` };
    }
    if (!response.ok) return missOf(url, response.status);
    return { bytes: new Uint8Array(await response.arrayBuffer()), etag: response.headers.get('etag') };
  }

  async function put(url: string, body: Uint8Array, condition: Record<string, string>): Promise<'written' | 'conflict' | ShareMiss> {
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(url, {
        method: options.method ?? 'PUT',
        headers: { 'content-type': 'application/octet-stream', ...headers, ...condition },
        body,
      });
    } catch (error) {
      return { kind: 'unreachable', detail: `${url}: ${(error as Error).message}` };
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

function missOf(url: string, status: number): ShareMiss {
  if (status === 404) return { kind: 'absent' };
  if (status === 401 || status === 403) return { kind: 'refused', detail: `${url}: HTTP ${String(status)}` };
  return { kind: 'unreachable', detail: `${url}: HTTP ${String(status)}` };
}
