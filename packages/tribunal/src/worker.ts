import type { Digest } from '@variance-authority/core/format';
import {
  APPROVALS_PATH,
  CHURN_PATH,
  CURRENT_PATH,
  FLAKINESS_PATH,
  LAST_CHANGED_PATH,
  OBSERVATIONS_PATH,
  REACH_PATH,
  VALUE_JOURNEY_PATH,
} from '@variance-authority/history';
import { RasterStoreError, rasterFrom } from '@variance-authority/raster';
import {
  HistoryWriteConflict,
  churnFrom,
  currentFrom,
  flakinessFrom,
  journeyFrom,
  lastChangedFrom,
  reachFrom,
} from '@variance-authority/server';
import type { TribunalBindings } from './bindings.js';
import { createD1Backend } from './history.js';
import { ReviewError, createReviewStore } from './review.js';
import { createBucketStore } from './store.js';
import { UNAUTHENTICATED, grant, refuseWeakTokens, requires, type Granted } from './worker-auth.js';
import {
  BadRequest,
  Forbidden,
  MethodNotAllowed,
  asRecordBody,
  count,
  json,
  optional,
  requireMethod,
  required,
  string,
} from './worker-http.js';
import {
  asApprovals,
  asBand,
  asBuildIngest,
  asCurrentRequest,
  asDecision,
  asIdentity,
  asKey,
  asRecordRequest,
  windowOf,
} from './worker-input.js';

/**
 * One `fetch` handler, three surfaces, and no outbound call.
 *
 * The operator writes the Worker entry and hands this their bindings; everything
 * below is the composition. Two of the three surfaces are protocols defined
 * elsewhere and re-served here, so a CLI configured with
 * `baselines.kind: "remote"` and a client built from
 * `@variance-authority/history/client` both reach this deployment unchanged.
 *
 * ## The Worker never calls anything
 *
 * No status check, no pull-request comment, no webhook, no telemetry. The
 * pipeline reports to the server and the server reports to nobody. That is the
 * project's standing constraint, and it is also what keeps this deployment free
 * of a credential for somebody else's system: there is nothing here to steal that
 * is useful anywhere but here.
 *
 * ## Two tokens, and what each one is for
 *
 * `ingest` is written into CI configuration and can write builds, baselines and
 * history. `review` belongs to people and can read the review surface and decide.
 * They are separate because deciding *promotes a baseline*, and one secret doing
 * both means anything that can read a CI log can approve a regression.
 *
 * They may not be equal, and construction refuses it. A deployment that set both
 * to the same value would satisfy every check in this file while having exactly
 * one secret, and nothing in a request would show it.
 *
 * ## Authentication happens before routing
 *
 * A caller holding neither token gets one sentence, whatever it asked for,
 * including for paths that do not exist. The alternative — 404 for unknown paths,
 * 401 for known ones — hands an unauthorised caller a map of the API, and on a
 * subject-scoped path it answers "that subject exists" to somebody holding
 * nothing.
 *
 * The *capability* check happens after routing, and deliberately: it can only be
 * reached by someone already holding a valid token, so telling them which of the
 * two a route wants reveals nothing they could not learn by trying.
 *
 * ## What is next door
 *
 * The token comparison and the capability rule are in
 * [`worker-auth.ts`](./worker-auth.ts); the refusals and the readers every route
 * validates in are in [`worker-http.ts`](./worker-http.ts) and
 * [`worker-input.ts`](./worker-input.ts). What is left here is the composition and
 * the routing table, which is the part an operator has to read.
 */

export interface TribunalOptions extends TribunalBindings {
  /** Scopes every row and object. One deployment, several repositories. */
  readonly project: string;
  /** Written into CI. Writes builds, baselines and history. At least 16 characters. */
  readonly ingestToken: string;
  /** Held by people. Reads the review surface and decides. At least 16 characters. */
  readonly reviewToken: string;
  /**
   * Days of builds to keep when `POST /review/sweep` is called.
   *
   * Applied on request rather than on a timer, because a Worker has no timer and
   * this package will not invent a cron the operator did not ask for. Wire it to a
   * scheduled trigger, or call it from a CI job, or never.
   */
  readonly retentionDays?: number;
  readonly now?: () => Date;
}

/**
 * The whole service, as one `fetch` handler.
 *
 * Deliberately nothing else. A handler is what a Worker exports, what a Next
 * route handler is, and what `node:http` can be adapted to in a dozen lines — so
 * the three deployments differ in their wiring and not in their router. It is
 * also the reason a `Tribunal` cannot be asked for its own tokens: a value with
 * one method has nothing to leak when it is logged.
 */
export interface Tribunal {
  fetch(request: Request): Promise<Response>;
}

/**
 * The baseline-store routes, restated.
 *
 * They are `@variance-authority/remote`'s and must stay byte-identical to them —
 * a client and a server disagreeing about a URL is the class of failure that
 * presents as a verdict. They are *restated* rather than imported because that
 * package's entrypoint pulls in `node:http` to serve them, and a Worker bundle
 * that drags a Node HTTP server in to read five string constants has acquired a
 * dependency on a runtime it is not running on.
 *
 * The equality is a test, not a hope: `worker.test.ts` imports the constants from
 * `remote` and asserts these against them, so drift fails the suite rather than a
 * deployment.
 */
const BASELINE_FIND_PATH = '/baseline/find';
const BASELINE_DESCRIBE_PATH = '/baseline/describe';
const BASELINE_PUT_PATH = '/baseline/put';
const CACHE_FIND_PATH = '/cache/find';
const CACHE_PUT_PATH = '/cache/put';

/**
 * Build the service over a database, a bucket and two tokens.
 *
 * Refuses a token under 16 characters and refuses two identical ones, here
 * rather than on the first request: a deployment whose ingest token also
 * promotes baselines is a misconfiguration that would otherwise be discovered by
 * the build log that used it.
 */
export function createTribunal(options: TribunalOptions): Tribunal {
  refuseWeakTokens(options);

  const baselines = createBucketStore(options);
  const history = createD1Backend(options.db);
  const review = createReviewStore(options);
  const retentionDays = options.retentionDays ?? 30;

  return {
    async fetch(request: Request): Promise<Response> {
      const granted = await grant(request, options);
      if (granted === null) {
        return json(401, { error: UNAUTHENTICATED }, { 'www-authenticate': 'Bearer' });
      }

      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return json(400, { error: `"${request.url}" is not a request URL` });
      }

      try {
        return await route({ baselines, history, review, retentionDays }, granted, url, request);
      } catch (error) {
        if (error instanceof BadRequest) return json(400, { error: error.message });
        if (error instanceof Forbidden) return json(403, { error: error.message });
        if (error instanceof MethodNotAllowed) {
          return json(405, { error: error.message }, { allow: error.allow });
        }
        if (error instanceof HistoryWriteConflict) return json(409, { error: error.message });
        if (error instanceof ReviewError) return json(422, { error: error.message });
        // Reported as a failure and never as an empty answer. Every client in
        // this project turns a non-2xx into a thrown error precisely so that a
        // broken service cannot become the sentence "no baseline" or "nothing has
        // drifted".
        return json(500, { error: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}

interface Surfaces {
  readonly baselines: ReturnType<typeof createBucketStore>;
  readonly history: ReturnType<typeof createD1Backend>;
  readonly review: ReturnType<typeof createReviewStore>;
  readonly retentionDays: number;
}

async function route(
  surfaces: Surfaces,
  granted: Granted,
  url: URL,
  request: Request,
): Promise<Response> {
  const path = url.pathname;

  // ------------------------------------------------------------- baselines
  if (path === BASELINE_FIND_PATH) {
    requires(granted, 'ingest', path);
    requireMethod(request, 'POST');
    const body = await asRecordBody(request);
    const found = await surfaces.baselines.find(asKey(body['key']), asIdentity(body['identity']));
    return json(200, { found });
  }

  if (path === BASELINE_DESCRIBE_PATH) {
    requires(granted, 'ingest', path);
    requireMethod(request, 'POST');
    const body = await asRecordBody(request);
    const described = await surfaces.baselines.describe(
      asKey(body['key']),
      asIdentity(body['identity']),
    );
    return json(200, { described });
  }

  if (path === BASELINE_PUT_PATH) {
    requires(granted, 'ingest', path);
    requireMethod(request, 'POST');
    const body = await asRecordBody(request);
    const raster = rasterFrom(body['raster']);
    if (raster === null) throw new BadRequest('`raster` is not a raster');
    await surfaces.baselines.put(asKey(body['key']), raster);
    return json(200, { ok: true });
  }

  if (path === CACHE_FIND_PATH) {
    requires(granted, 'ingest', path);
    requireMethod(request, 'POST');
    const body = await asRecordBody(request);
    const digest = body['digest'];
    if (typeof digest !== 'string') throw new BadRequest('`digest` must be a string');
    const raster = await surfaces.baselines.renderCache.get(
      digest as Digest,
      asIdentity(body['identity']),
    );
    return json(200, { raster });
  }

  if (path === CACHE_PUT_PATH) {
    requires(granted, 'ingest', path);
    requireMethod(request, 'POST');
    const body = await asRecordBody(request);
    const raster = rasterFrom(body['raster']);
    if (raster === null) throw new BadRequest('`raster` is not a raster');
    await surfaces.baselines.renderCache.put(raster);
    return json(200, { ok: true });
  }

  // --------------------------------------------------------------- history
  const project = optional(url, 'project');

  if (path === OBSERVATIONS_PATH) {
    requires(granted, 'ingest', path);
    requireMethod(request, 'POST');
    const write = await asRecordRequest(request);
    await surfaces.history.append(write.run, write.observations, write.tokens, write.instabilities);
    // 204: the write left nothing to say, and the client treats any body on this
    // route as a shape error rather than guessing at it.
    return new Response(null, { status: 204 });
  }

  if (path === APPROVALS_PATH) {
    requires(granted, 'ingest', path);
    requireMethod(request, 'POST');
    await surfaces.history.appendApprovals(await asApprovals(request));
    return new Response(null, { status: 204 });
  }

  if (path === CURRENT_PATH) {
    // A read, and still a POST, and still the ingest capability. Its argument is
    // a subject list — three hundred subject ids in a query string is a 414 from
    // a proxy nobody configured — and its caller is a run deciding what to write,
    // not a person deciding what to ship (`CurrentRequest`).
    requires(granted, 'ingest', path);
    requireMethod(request, 'POST');
    return json(200, await currentFrom(surfaces.history, project, await asCurrentRequest(request)));
  }

  if (path === LAST_CHANGED_PATH) {
    readable(granted, path);
    requireMethod(request, 'GET');
    const band = optional(url, 'band');
    return json(200, {
      observation: await lastChangedFrom(
        surfaces.history,
        project,
        required(url, 'subject'),
        required(url, 'component'),
        band === undefined ? undefined : asBand(band, 'the `band` parameter'),
      ),
    });
  }

  if (path === CHURN_PATH) {
    readable(granted, path);
    requireMethod(request, 'GET');
    return json(
      200,
      await churnFrom(surfaces.history, project, required(url, 'component'), windowOf(url)),
    );
  }

  if (path === VALUE_JOURNEY_PATH) {
    readable(granted, path);
    requireMethod(request, 'GET');
    return json(
      200,
      await journeyFrom(surfaces.history, project, required(url, 'token'), windowOf(url)),
    );
  }

  if (path === REACH_PATH) {
    readable(granted, path);
    requireMethod(request, 'GET');
    return json(
      200,
      await reachFrom(surfaces.history, project, required(url, 'component'), windowOf(url)),
    );
  }

  if (path === FLAKINESS_PATH) {
    readable(granted, path);
    requireMethod(request, 'GET');
    return json(
      200,
      await flakinessFrom(surfaces.history, project, required(url, 'subject'), windowOf(url)),
    );
  }

  // ---------------------------------------------------------------- review
  if (path === '/review/builds' && request.method === 'POST') {
    // The one review route the ingest token owns, and the only one it owns:
    // posting a build is what CI does, and everything else on this surface is
    // what a person does.
    requires(granted, 'ingest', path);
    await surfaces.review.ingest(await asBuildIngest(request));
    return json(201, { ok: true });
  }

  if (path === '/review/builds') {
    requires(granted, 'review', path);
    requireMethod(request, 'GET');
    const limit = optional(url, 'limit');
    return json(200, { builds: await surfaces.review.builds(limit === undefined ? undefined : count(limit)) });
  }

  if (path === '/review/changelog') {
    requires(granted, 'review', path);
    requireMethod(request, 'GET');
    const limit = optional(url, 'limit');
    return json(
      200,
      await surfaces.review.changelog({
        ...(optional(url, 'component') !== undefined
          ? { component: required(url, 'component') }
          : {}),
        ...(optional(url, 'subject') !== undefined ? { subject: required(url, 'subject') } : {}),
        ...(optional(url, 'since') !== undefined ? { since: required(url, 'since') } : {}),
        ...(limit !== undefined ? { limit: count(limit) } : {}),
      }),
    );
  }

  if (path === '/review/sweep') {
    requires(granted, 'review', path);
    requireMethod(request, 'POST');
    const days = optional(url, 'days');
    // Reported rather than performed silently. An operator who cannot see what a
    // sweep removed cannot tell a working retention policy from one deleting a
    // build a day.
    return json(200, await surfaces.review.sweep(days === undefined ? surfaces.retentionDays : count(days)));
  }

  const build = /^\/review\/builds\/([^/]+)$/.exec(path);
  if (build?.[1] !== undefined) {
    requires(granted, 'review', path);
    requireMethod(request, 'GET');
    const detail = await surfaces.review.build(decodeURIComponent(build[1]));
    return detail === null
      ? json(404, { error: `no build "${decodeURIComponent(build[1])}" in this project` })
      : json(200, detail);
  }

  const decision = /^\/review\/builds\/([^/]+)\/subjects\/([^/]+)\/decision$/.exec(path);
  if (decision?.[1] !== undefined && decision[2] !== undefined) {
    requires(granted, 'review', path);
    requireMethod(request, 'POST');
    const body = await asRecordBody(request);
    return json(
      200,
      await surfaces.review.decide({
        build: decodeURIComponent(decision[1]),
        subject: decodeURIComponent(decision[2]),
        decision: asDecision(body['decision']),
        by: string(body, 'by', 'the decision'),
        ...(typeof body['note'] === 'string' && body['note'] !== '' ? { note: body['note'] } : {}),
      }),
    );
  }

  const image = /^\/review\/builds\/([^/]+)\/subjects\/([^/]+)\/(before|after|diff)\.png$/.exec(path);
  if (image?.[1] !== undefined && image[2] !== undefined && image[3] !== undefined) {
    requires(granted, 'review', path);
    requireMethod(request, 'GET');
    const bytes = await surfaces.review.image(
      decodeURIComponent(image[1]),
      decodeURIComponent(image[2]),
      image[3] as 'before' | 'after' | 'diff',
    );
    if (bytes === null) return json(404, { error: 'this build kept no such image' });
    return new Response(bytes, {
      headers: {
        'content-type': 'image/png',
        // A build's images never change: the row is written once and the object
        // with it. Anything a reviewer reloads is fetched again for nothing.
        'cache-control': 'private, max-age=31536000, immutable',
      },
    });
  }

  return json(404, {
    error:
      `no route for ${request.method} ${path}. This deployment answers the baseline routes ` +
      `(${BASELINE_FIND_PATH}, ${BASELINE_DESCRIBE_PATH}, ${BASELINE_PUT_PATH}, ` +
      `${CACHE_FIND_PATH}, ${CACHE_PUT_PATH}), the history routes (${OBSERVATIONS_PATH}, ` +
      `${APPROVALS_PATH}, ${CURRENT_PATH}, ${LAST_CHANGED_PATH}, ${CHURN_PATH}, ` +
      `${FLAKINESS_PATH}, ${VALUE_JOURNEY_PATH}, ${REACH_PATH}) and /review/builds and ` +
      '/review/changelog. A path from a different API version is a client and a service that ' +
      'disagree about a recorded shape',
  });
}

/**
 * The history routes that answer a question rather than record one.
 *
 * Either capability may ask. The split everywhere else in this file is *who is
 * allowed to write*, and these five write nothing: churn, reach, flakiness, the
 * value journey and the last change are derived from rows already recorded. A
 * reviewer looking at a build needs exactly these to know whether the difference
 * in front of them is the third this week or the first this year, and the browser
 * that draws that page holds the review token — so refusing them here would mean
 * a review surface that can approve a change it cannot put in context.
 *
 * It stays a rule with a name rather than an omitted check, because the next
 * history route added is a write far more often than it is a read, and the
 * default has to be the strict one.
 */
function readable(granted: Granted, path: string): void {
  if (granted !== 'ingest') requires(granted, 'review', path);
}

/** Re-exported so a Worker entry can recognise a store failure without a second import. */
export { RasterStoreError };
