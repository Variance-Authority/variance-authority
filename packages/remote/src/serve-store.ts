import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Digest, Raster, RenderIdentity } from '@variance-authority/core';
import {
  RasterStoreError,
  recordFrom,
  type BaselineKey,
  type RasterStore,
} from '@variance-authority/raster';
import {
  BASELINE_DESCRIBE_PATH,
  BASELINE_FIND_PATH,
  BASELINE_PUT_PATH,
  BASELINE_WORKING_SET_PATH,
  CACHE_FIND_PATH,
  CACHE_PUT_PATH,
} from './store.js';

/**
 * The serving half of the baseline protocol.
 *
 * Beside the client rather than in a package of its own: they are one wire
 * format, and a client and a server that can be released apart are a client and
 * a server that disagree about it. Beside rather than *in*, because the two are
 * read for different reasons — one by an operator wiring a run, one by an
 * operator standing a service up — and the paths they share are the only thing
 * that has to be the same file.
 */

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

    const body = recordFrom(JSON.parse(await readBody(request_)));
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
      case BASELINE_WORKING_SET_PATH: {
        // Served by looping `describe`, deliberately. The saving this path exists
        // for is the round trips, and a backend-specific bulk read would be a
        // second implementation of the sibling scan that decides `comparable`.
        const identity = body.identity as RenderIdentity;
        const keys = Array.isArray(body.keys) ? (body.keys as readonly BaselineKey[]) : [];
        const entries = await Promise.all(
          keys.map(async (key) => ({ key, described: await store.describe(key, identity) })),
        );
        send(response, 200, { entries });
        return;
      }
      case BASELINE_DESCRIBE_PATH: {
        const described = await store.describe(
          body.key as BaselineKey,
          body.identity as RenderIdentity,
        );
        send(response, 200, { described });
        return;
      }
      case BASELINE_PUT_PATH: {
        await store.put(body.key as BaselineKey, body.raster as Raster);
        send(response, 200, { ok: true });
        return;
      }
      case CACHE_FIND_PATH: {
        const raster = await store.renderCache.get(
          body.digest as Digest,
          body.identity as RenderIdentity,
        );
        send(response, 200, { raster });
        return;
      }
      case CACHE_PUT_PATH: {
        await store.renderCache.put(body.raster as Raster);
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
