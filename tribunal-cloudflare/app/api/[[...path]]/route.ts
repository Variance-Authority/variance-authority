import { createTribunalRoutes, type TribunalRoutes } from '@variance-authority/tribunal/next';
import { identify } from '../../access';
import { TOKENS, tribunal } from '../../tribunal';

/**
 * Every service route, mounted once.
 *
 * The whole router — baselines, cache, history, review, sweep — is one `fetch`
 * handler, so this file is the mount point and not a list of endpoints that
 * could fall behind the package's own.
 *
 * `authorize` is this deployment's policy, and the package supplies no default
 * because a default here is a published approve button:
 *
 * - the ingest token, as a bearer, is CI. It writes and cannot decide.
 * - an Access identity is a person. They review.
 * - the review token, as a bearer, is a machine acting for the operator — the
 *   `variance` CLI approving from a script, or a second service. It reviews.
 * - anything else is refused before the service sees the request.
 *
 * The review token is a capability and Access is an identity, and the difference
 * is not politeness: the token can be held by anything the operator hands it to,
 * so nothing that holds it gets a name. That is why the page at `/` is drawn for
 * an Access identity and never for a bearer — a rendered review surface has to
 * put a reviewer's name on a decision, and a token has none to give.
 *
 * A caller may not choose its own capability: `createTribunalRoutes` **replaces**
 * the authorization header with the token the answer implies, so a browser
 * sending `Bearer <anything>` is still whatever Access says it is.
 */

let routes: TribunalRoutes | undefined;

/**
 * Built on the first request rather than at module scope.
 *
 * `createTribunal` refuses a token under 16 characters and two identical tokens,
 * and a Worker that throws while evaluating its module fails deployment-wide with
 * a platform error somebody has to go and find. Constructed here, the same
 * refusal arrives as a 500 whose body is the sentence.
 */
function handlers(): TribunalRoutes {
  routes ??= createTribunalRoutes(tribunal(), {
    basePath: '/api',
    authorize: async (request: Request) => {
      const header = request.headers.get('authorization') ?? '';
      const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
      if (bearer !== null && bearer === TOKENS.ingest) return 'ingest';
      if (bearer !== null && bearer === TOKENS.review) return 'review';
      return (await identify(request)) === null ? null : 'review';
    },
    tokens: TOKENS,
  });
  return routes;
}

async function serve(
  method: keyof TribunalRoutes,
  request: Request,
): Promise<Response> {
  try {
    return await handlers()[method](request);
  } catch (error) {
    routes = undefined;
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'this deployment is misconfigured',
      }),
      { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  }
}

export const GET = (request: Request): Promise<Response> => serve('GET', request);
export const POST = (request: Request): Promise<Response> => serve('POST', request);
export const HEAD = (request: Request): Promise<Response> => serve('HEAD', request);
