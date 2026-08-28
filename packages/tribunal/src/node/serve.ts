import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTribunalRoutes } from '../next.js';
import type { Tribunal } from '../worker.js';
import { reviewPage, uiAsset } from './ui-assets.js';

/**
 * The socket: `node:http` in, {@link Tribunal.fetch} out.
 *
 * A Worker handler is `(Request) => Promise<Response>` and a Node server is
 * `(IncomingMessage, ServerResponse) => void`, and the whole of this file is the
 * conversion between those two plus the two decisions the conversion forces.
 * Nothing here knows what a build is; every route, every refusal and every status
 * code is the same code a Cloudflare deployment runs.
 *
 * Shaped after [`server/http.ts`](../../../server/src/http.ts): `node:http`, no
 * framework, and no logic of its own beyond transport.
 *
 * ## The two decisions
 *
 * **A body has a ceiling.** A Worker gets one from the platform; a Node process
 * gets one from whoever wrote the reader. An unbounded `POST /review/builds`
 * carrying three hundred base64 PNGs is a heap the operator did not budget for,
 * and the failure mode is the process dying rather than the request being
 * refused. So there is a limit, it is a number, and exceeding it is a 413 with a
 * sentence rather than an OOM.
 *
 * **Who may review is not this file's to assume.** The review token promotes
 * baselines, so a browser must never hold it — the argument is in
 * [`next.ts`](../next.ts) and it does not change because the host did. So
 * `authorize` is required here too, and the mount reuses `createTribunalRoutes`
 * rather than re-deriving the token-attaching rule: one implementation of "which
 * capability is this caller allowed" means the Node service and the Next.js app
 * cannot drift into two answers.
 */

/**
 * Largest request body accepted, in bytes.
 *
 * 256 MiB: a build posts every image it kept, base64-encoded, in one JSON
 * document, and a wide Storybook at two device scales gets big. It is a ceiling
 * on damage rather than a target — an operator whose builds approach it should
 * be keeping fewer images, not raising this.
 */
export const MAX_BODY_BYTES = 256 * 1024 * 1024;

export interface TribunalServiceOptions {
  readonly tribunal: Tribunal;
  /**
   * Which capability a request is allowed. No default — see the note above.
   *
   * The shipped policy is in [`bin.ts`](./bin.ts), where an operator can read it.
   */
  authorize(request: Request): Promise<'ingest' | 'review' | null> | 'ingest' | 'review' | null;
  /** The tokens the tribunal was constructed with, for the mount to attach. */
  readonly tokens: { readonly ingest: string; readonly review: string };
  /**
   * Serve the review surface at `/`, not just the JSON API.
   *
   * Default `true`. Off is for a deployment that only ingests — a service behind
   * CI with no reviewer on it — where a page nobody opens is a page nobody has to
   * authorize.
   */
  readonly ui?: boolean;
  /** Shown in the surface as who is deciding. The record carries it on every approval. */
  readonly reviewer?: string;
}

export interface TribunalService {
  readonly server: Server;
  /** Where it is actually listening, with the port the OS chose if `0` was asked for. */
  readonly url: string;
  close(): Promise<void>;
}

/** Listen, and resolve once the socket is accepting. */
export async function serveTribunal(
  options: TribunalServiceOptions & { readonly host: string; readonly port: number },
): Promise<TribunalService> {
  const server = createServer(createRequestListener(options));

  await new Promise<void>((accept, refuse) => {
    server.once('error', refuse);
    server.listen(options.port, options.host, () => {
      server.removeListener('error', refuse);
      accept();
    });
  });

  const address = server.address() as AddressInfo;
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;

  return {
    server,
    url: `http://${host}:${address.port}`,
    close: () =>
      new Promise<void>((accept, refuse) => {
        server.close((error) => (error === undefined ? accept() : refuse(error)));
      }),
  };
}

/**
 * The handler, without the socket — so a test can drive it and a host that
 * already owns its listener can mount it.
 */
export function createRequestListener(
  options: TribunalServiceOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const mounted = createTribunalRoutes(options.tribunal, {
    authorize: options.authorize,
    tokens: options.tokens,
  });
  const serveUi = options.ui ?? true;

  return (incoming: IncomingMessage, outgoing: ServerResponse): void => {
    void (async () => {
      try {
        const request = await requestOf(incoming);

        const asset = serveUi ? await pageOrAsset(request, options.reviewer) : null;
        const response = asset ?? (await mounted[method(request)](request));

        await write(outgoing, response);
      } catch (error) {
        await write(outgoing, refusal(error));
      }
    })();
  };
}

/**
 * The surface and its bundle, ahead of the API.
 *
 * Only two paths, and both are exact: a prefix match would shadow a future route
 * the day one is added, and this file must not be the reason a request never
 * reached the router.
 */
async function pageOrAsset(request: Request, reviewer?: string): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;

  if (path === '/' || path === '/index.html') {
    return new Response(reviewPage({ endpoint: '', ...(reviewer === undefined ? {} : { reviewer }) }), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  if (path === '/ui/review.js') {
    const bundle = await uiAsset();
    if (bundle === null) return null;
    return new Response(bundle, {
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        // Immutable because the file changes only when the package does, and a
        // reviewer who upgrades gets a new process on a new URL-less asset —
        // so this is a lie the moment the bundle is rebuilt in place. It is
        // therefore `no-cache`: revalidate, do not re-download.
        'cache-control': 'no-cache',
      },
    });
  }

  return null;
}

function method(request: Request): 'GET' | 'POST' | 'HEAD' {
  if (request.method === 'POST') return 'POST';
  if (request.method === 'HEAD') return 'HEAD';
  return 'GET';
}

/** `IncomingMessage` → `Request`, with the body read to a ceiling. */
async function requestOf(incoming: IncomingMessage): Promise<Request> {
  const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost'}`);

  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
  }

  const method = incoming.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }

  return new Request(url, { method, headers, body: await body(incoming) });
}

async function body(incoming: IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of incoming) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_BODY_BYTES) {
      incoming.destroy();
      throw new PayloadTooLarge(
        `this request body is over ${MAX_BODY_BYTES} bytes, which is the ceiling this service ` +
          'accepts. A build carrying every image it kept is the way this happens; keep fewer ' +
          'images, or split the build across two posts',
      );
    }
    chunks.push(chunk as Buffer);
  }

  const joined = Buffer.concat(chunks);
  return joined.buffer.slice(joined.byteOffset, joined.byteOffset + joined.byteLength) as ArrayBuffer;
}

/** `Response` → `ServerResponse`. */
async function write(outgoing: ServerResponse, response: Response): Promise<void> {
  for (const [name, value] of response.headers) outgoing.setHeader(name, value);
  outgoing.statusCode = response.status;

  if (response.body === null) {
    outgoing.end();
    return;
  }
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

class PayloadTooLarge extends Error {}

/**
 * An exception is a 500 with a sentence, and a refused body is a 413.
 *
 * Nothing in `Tribunal.fetch` throws — it answers with a status — so anything
 * arriving here is transport or a construction failure, and the operator reading
 * it is the person who can fix it. The message is theirs; the stack is not.
 */
function refusal(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'this service could not answer';
  return new Response(JSON.stringify({ error: message }), {
    status: error instanceof PayloadTooLarge ? 413 : 500,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
