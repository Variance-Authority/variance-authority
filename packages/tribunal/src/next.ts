import type { Tribunal } from './worker.js';

/**
 * The Worker, mounted inside a Next.js App Router app — which on Cloudflare means
 * [vinext](https://vinext.io).
 *
 * The whole adapter is one idea: a Next route handler is
 * `(Request) => Response | Promise<Response>`, and so is
 * {@link Tribunal.fetch}. What is left is a mount prefix to strip and one
 * decision the operator has to make, below.
 *
 * ```ts
 * // app/variance/[[...path]]/route.ts
 * import { createTribunal } from '@variance-authority/tribunal/worker';
 * import { createTribunalRoutes } from '@variance-authority/tribunal/next';
 *
 * const worker = createTribunal({
 *   db: process.env.DB, bucket: process.env.BUCKET, project: 'todomvc',
 *   ingestToken: process.env.VARIANCE_INGEST_TOKEN!,
 *   reviewToken: process.env.VARIANCE_REVIEW_TOKEN!,
 * });
 *
 * export const { GET, POST, HEAD } = createTribunalRoutes(worker, {
 *   basePath: '/variance',
 *   authorize: async (request) => (await isSignedIn(request)) ? 'review' : null,
 * });
 * ```
 *
 * ## The one decision this adapter does not make for you
 *
 * A browser rendering the review surface must not be handed the review token —
 * a token in a page is a token in everybody's devtools, and this one **promotes
 * baselines**. So the token stays on the server and the handler attaches it,
 * which means the handler, not the token, is now the gate.
 *
 * `authorize` is that gate, and it has no default. Returning `'review'` for every
 * request would publish an approve button to the internet, and a package that
 * shipped that as a convenience would be shipping the failure. An operator who
 * genuinely wants the surface open writes `() => 'review'` themselves, in their
 * own file, where the next person reviewing that repository can see it.
 *
 * A request that `authorize` refuses is answered 401 here, without reaching the
 * Worker — so the app's own session and the deployment's tokens stay two
 * separate things, and neither is asked to be the other.
 */

export interface TribunalRouteOptions {
  /**
   * Where the route is mounted, e.g. `/variance` for `app/variance/[[...path]]`.
   *
   * Stripped before the request reaches the Worker, which knows only its own
   * paths. Without it every request would arrive as `/variance/review/builds`
   * and 404 against a route table that has never heard of the prefix.
   */
  readonly basePath?: string;

  /**
   * Which capability this request is allowed, decided by the operator's own app.
   *
   * `null` is a 401. There is no default — see the note above.
   */
  authorize(request: Request): Promise<'ingest' | 'review' | null> | 'ingest' | 'review' | null;

  /**
   * The tokens the Worker was constructed with.
   *
   * Passed again rather than read off the worker, because a `Tribunal` is
   * deliberately a `fetch` handler and nothing else: a handler that could be
   * asked for its own secrets is a handler that can leak them by being logged.
   */
  readonly tokens: { readonly ingest: string; readonly review: string };
}

export interface TribunalRoutes {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
  HEAD(request: Request): Promise<Response>;
}

export function createTribunalRoutes(
  worker: Tribunal,
  options: TribunalRouteOptions,
): TribunalRoutes {
  const basePath = (options.basePath ?? '').replace(/\/$/, '');

  const handle = async (request: Request): Promise<Response> => {
    const granted = await options.authorize(request);
    if (granted === null) {
      return new Response(JSON.stringify({ error: 'not authorized for this deployment' }), {
        status: 401,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    const url = new URL(request.url);
    if (basePath !== '' && url.pathname.startsWith(basePath)) {
      url.pathname = url.pathname.slice(basePath.length) || '/';
    }

    const headers = new Headers(request.headers);
    // Replaced rather than added. A caller that sent its own bearer would
    // otherwise decide its own capability, and `authorize` would be advisory.
    headers.set(
      'authorization',
      `Bearer ${granted === 'ingest' ? options.tokens.ingest : options.tokens.review}`,
    );

    return worker.fetch(
      new Request(url, {
        method: request.method,
        headers,
        ...(request.method === 'GET' || request.method === 'HEAD'
          ? {}
          : { body: await request.arrayBuffer() }),
      }),
    );
  };

  return {
    GET: handle,
    POST: handle,
    // A `HEAD` is a `GET` whose body Next discards. Declared so the framework
    // does not answer 405 for a request every image preloader makes.
    HEAD: handle,
  };
}
