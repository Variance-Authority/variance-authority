import type { Tribunal } from './worker.js';

/**
 * The Worker, mounted inside a Next.js App Router app — which on Cloudflare means
 * [vinext](https://vinext.io).
 *
 * The whole adapter is one idea: a Next route handler is
 * `(Request) => Response | Promise<Response>`, and so is
 * {@link Tribunal.fetch}. What is left is a mount prefix to strip.
 *
 * ```ts
 * // app/variance/[[...path]]/route.ts
 * import { createTribunal, declaredPolicy } from '@variance-authority/tribunal/worker';
 * import { createTribunalRoutes } from '@variance-authority/tribunal/next';
 *
 * const worker = createTribunal({
 *   db: process.env.DB, bucket: process.env.BUCKET, project: 'todomvc',
 *   policy: declaredPolicy(process.env),
 * });
 *
 * export const { GET, POST, PUT, HEAD } = createTribunalRoutes(worker, { basePath: '/variance' });
 * ```
 *
 * Who a request is stays the policy's, here as everywhere. An app that already
 * knows its users writes a `Policy` over its own session, which keeps a decision
 * attributed to the person that session proved.
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
}

/**
 * The four method exports a Next.js route file needs.
 *
 * `GET`, `POST`, `PUT` and `HEAD` are the same handler; the framework wants them
 * named. `PUT` is the verb a share writes with. Spread them straight out of a
 * route module — `export const { GET, POST, PUT, HEAD } = createTribunalRoutes(...)`.
 */
export interface TribunalRoutes {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
  PUT(request: Request): Promise<Response>;
  HEAD(request: Request): Promise<Response>;
}

/** Mount the service inside an app, under `basePath`. */
export function createTribunalRoutes(
  worker: Tribunal,
  options: TribunalRouteOptions = {},
): TribunalRoutes {
  const basePath = (options.basePath ?? '').replace(/\/$/, '');

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (basePath !== '' && url.pathname.startsWith(basePath)) {
      url.pathname = url.pathname.slice(basePath.length) || '/';
    }

    return worker.fetch(
      new Request(url, {
        method: request.method,
        headers: request.headers,
        ...(request.method === 'GET' || request.method === 'HEAD'
          ? {}
          : { body: await request.arrayBuffer() }),
      }),
    );
  };

  return {
    GET: handle,
    POST: handle,
    PUT: handle,
    // A `HEAD` is a `GET` whose body Next discards. Declared so the framework
    // does not answer 405 for a request every image preloader makes.
    HEAD: handle,
  };
}
