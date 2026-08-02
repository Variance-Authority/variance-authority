import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  identityDigest,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
} from '@variance-authority/core';
import {
  describeIdentity,
  identityAtScale,
  type Renderer,
} from '@variance-authority/raster';

/**
 * Offloading — the same renderer, on the other side of a hop.
 *
 * This is the direct answer to the cost that made Docker the industry default.
 * A pixel baseline is only valid on the machine that produced it, so the usual
 * response is to pin *the whole pipeline* in a container and pay for it on every
 * tier — in order to stabilise the tier that, on this corpus, decides nothing
 * (ADR-0010). Sending a document to one pinned renderer inverts that: the
 * deciding tier runs on whatever machine is nearest and cheapest, and only the
 * residue that genuinely needs stable pixels crosses the wire.
 *
 * The protocol is deliberately dull. A `RenderDocument` is already plain
 * serializable data and a `Raster` carries its bytes as base64 for exactly this
 * reason, so the transport is `JSON.stringify` and the interesting question —
 * *is the machine on the other end the one that wrote the baseline?* — is
 * answered by `identity`, not by trusting the URL.
 */

export const RENDER_PATH = '/render';
export const IDENTITY_PATH = '/identity';

export interface RemoteRendererOptions {
  /** Base URL of a server started by {@link serveRenderer}, e.g. `http://box:7777`. */
  readonly endpoint: string;
  /** Milliseconds. A render that hangs must fail, not stall the run. */
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * A renderer that is somewhere else.
 *
 * Its identity is fetched at construction rather than declared by the caller.
 * Declaring it would let a misconfigured endpoint pass a comparability check it
 * should fail — which produces a confident diff between two different machines,
 * the exact failure the durable mode exists to prevent.
 */
export async function connectRenderer(options: RemoteRendererOptions): Promise<Renderer> {
  const get = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const identity = (await request(
    get,
    `${options.endpoint}${IDENTITY_PATH}`,
    undefined,
    timeoutMs,
  )) as RenderIdentity;

  /**
   * Predicted locally rather than asked for over the wire.
   *
   * A round trip per document to learn a value the far end computes by a known
   * rule would double the request count of the one phase this project offloads
   * to make it cheaper. The prediction is checked instead, on the raster that
   * comes back — so a far end that disagrees is a loud failure rather than a
   * baseline filed under a key nobody will ever look up.
   */
  const identityFor = (document: RenderDocument): RenderIdentity =>
    identityAtScale(identity, document);

  return {
    identity,
    identityFor,

    async render(document: RenderDocument): Promise<Raster> {
      const raster = (await request(
        get,
        `${options.endpoint}${RENDER_PATH}`,
        document,
        timeoutMs,
      )) as Raster;

      const expected = identityFor(document);
      if (identityDigest(raster.identity) !== identityDigest(expected)) {
        // The caller has already keyed a baseline lookup on `identityFor`. If
        // the far end stamped something else, storing this raster files it where
        // nothing reads, and every later run reports the subject new or
        // incomparable while the endpoint looks healthy. Refusing here names the
        // disagreement once, at the hop that caused it.
        throw new Error(
          `render server ${options.endpoint} returned a raster rendered as ` +
            `${describeIdentity(raster.identity)}, but this document was sent to be rendered as ` +
            `${describeIdentity(expected)}; the two would be stored and looked up under different keys`,
        );
      }

      return raster;
    },
    async close(): Promise<void> {
      // Nothing to close. The renderer's lifetime belongs to whoever runs the
      // server; a client that could shut it down would let one test run end
      // another's.
    },
  };
}

async function request(
  get: typeof globalThis.fetch,
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await get(url, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`render server ${url} returned ${response.status}: ${await response.text()}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export interface RenderServer {
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Expose a renderer over HTTP.
 *
 * Thin on purpose: it owns no rendering logic, so the local and remote paths
 * cannot drift into two implementations that produce different images. The
 * server is the local renderer plus a socket, which is the only arrangement in
 * which "offloaded" and "local" are guaranteed to mean the same thing.
 */
export async function serveRenderer(renderer: Renderer, port = 0): Promise<RenderServer> {
  const server = createServer((request_, response) => {
    void handle(renderer, request_, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('render server did not bind a TCP port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

async function handle(
  renderer: Renderer,
  request_: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    if (request_.url === IDENTITY_PATH) {
      send(response, 200, renderer.identity);
      return;
    }

    if (request_.url !== RENDER_PATH || request_.method !== 'POST') {
      send(response, 404, { error: `no route for ${request_.method ?? '?'} ${request_.url ?? '?'}` });
      return;
    }

    const document = JSON.parse(await readBody(request_)) as RenderDocument;
    send(response, 200, await renderer.render(document));
  } catch (error) {
    // Reported as a failure, never as an empty image. A renderer that answers a
    // broken document with a blank PNG produces a comparison that says the whole
    // subject changed, and the report then blames the component.
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
