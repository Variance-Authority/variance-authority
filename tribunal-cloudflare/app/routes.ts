import { createTribunalRoutes, type TribunalRoutes } from '@variance-authority/tribunal/next';
import { tribunal } from './tribunal';

/**
 * The service as route handlers, mounted at `basePath`.
 *
 * Built on the first request rather than at module scope. `declaredPolicy` refuses
 * a declaration it cannot honour, and a Worker that throws while evaluating its
 * module fails deployment-wide with a platform error somebody has to go and find.
 * Constructed here, the same refusal arrives as a 500 whose body is the sentence.
 */
export function mounted(basePath: string): TribunalRoutes {
  let routes: TribunalRoutes | undefined;

  const serve = async (method: keyof TribunalRoutes, request: Request): Promise<Response> => {
    try {
      routes ??= createTribunalRoutes(tribunal(), { basePath });
      return await routes[method](request);
    } catch (error) {
      routes = undefined;
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'this deployment is misconfigured',
        }),
        { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } },
      );
    }
  };

  return {
    GET: (request) => serve('GET', request),
    POST: (request) => serve('POST', request),
    PUT: (request) => serve('PUT', request),
    HEAD: (request) => serve('HEAD', request),
  };
}
