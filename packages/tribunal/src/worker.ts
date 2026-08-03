import { profileById, type Digest, type ProfileId } from '@variance-authority/core';
import {
  BANDS,
  CHURN_PATH,
  LAST_CHANGED_PATH,
  OBSERVATIONS_PATH,
  REACH_PATH,
  VALUE_JOURNEY_PATH,
  type Band,
  type Observation,
  type RunRecord,
  type TokenValue,
  type Window,
} from '@variance-authority/history';
import { RasterStoreError, identityFrom, rasterFrom } from '@variance-authority/raster';
import type { RunReport } from '@variance-authority/report';
import { HistoryWriteConflict, churnFrom, journeyFrom, lastChangedFrom, reachFrom } from '@variance-authority/server';
import type { TribunalBindings } from './bindings.js';
import { createD1Backend } from './history.js';
import {
  ReviewError,
  createReviewStore,
  type BuildIngest,
  type Decision,
  type SubjectImages,
} from './review.js';
import { createBucketStore } from './store.js';

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

/** The shortest token this will start with. A short shared secret is a public one. */
const MIN_TOKEN = 16;

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

/** Which of the two secrets a request presented, or nothing at all. */
type Granted = 'ingest' | 'review';

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
    const raster = await surfaces.baselines.cached(
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
    await surfaces.baselines.cache(raster);
    return json(200, { ok: true });
  }

  // --------------------------------------------------------------- history
  const project = optional(url, 'project');

  if (path === OBSERVATIONS_PATH) {
    requires(granted, 'ingest', path);
    requireMethod(request, 'POST');
    const write = await asRecordRequest(request);
    await surfaces.history.append(write.run, write.observations, write.tokens);
    // 204: the write left nothing to say, and the client treats any body on this
    // route as a shape error rather than guessing at it.
    return new Response(null, { status: 204 });
  }

  if (path === LAST_CHANGED_PATH) {
    requires(granted, 'ingest', path);
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
    requires(granted, 'ingest', path);
    requireMethod(request, 'GET');
    return json(
      200,
      await churnFrom(surfaces.history, project, required(url, 'component'), windowOf(url)),
    );
  }

  if (path === VALUE_JOURNEY_PATH) {
    requires(granted, 'ingest', path);
    requireMethod(request, 'GET');
    return json(
      200,
      await journeyFrom(surfaces.history, project, required(url, 'token'), windowOf(url)),
    );
  }

  if (path === REACH_PATH) {
    requires(granted, 'ingest', path);
    requireMethod(request, 'GET');
    return json(
      200,
      await reachFrom(surfaces.history, project, required(url, 'component'), windowOf(url)),
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
      `${LAST_CHANGED_PATH}, ${CHURN_PATH}, ${VALUE_JOURNEY_PATH}, ${REACH_PATH}) and ` +
      '/review/builds. A path from a different API version is a client and a service that ' +
      'disagree about a recorded shape',
  });
}

/**
 * The one sentence a caller holding neither token ever gets.
 *
 * Identical for a missing token, a wrong token, and a path that does not exist.
 * Any variation between those three is an oracle.
 */
const UNAUTHENTICATED = 'a valid bearer token is required';

/**
 * Which token was presented, compared in constant time.
 *
 * Both are hashed to a fixed 32 bytes before comparison and the comparison never
 * exits early. `===` on strings leaks the length of the common prefix through
 * timing; comparing raw strings of different lengths leaks the token's length. A
 * digest makes every comparison the same shape whatever arrives.
 *
 * Both candidates are always checked, even after the first one matches, so that
 * "which token is this" costs the same either way.
 */
async function grant(request: Request, options: TribunalOptions): Promise<Granted | null> {
  const header = request.headers.get('authorization');
  if (header === null) return null;

  const match = /^Bearer (.+)$/i.exec(header.trim());
  const presented = match?.[1];
  if (presented === undefined) return null;

  const digest = await fingerprint(presented);
  const isIngest = equal(digest, await fingerprint(options.ingestToken));
  const isReview = equal(digest, await fingerprint(options.reviewToken));

  return isIngest ? 'ingest' : isReview ? 'review' : null;
}

async function fingerprint(token: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function refuseWeakTokens(options: TribunalOptions): void {
  for (const [name, token] of [
    ['ingestToken', options.ingestToken],
    ['reviewToken', options.reviewToken],
  ] as const) {
    if (token.trim().length < MIN_TOKEN) {
      throw new Error(
        `\`${name}\` is shorter than ${MIN_TOKEN} characters. This deployment holds every ` +
          'baseline and every observation a project has produced, and it can promote one; a ' +
          'guessable shared secret in front of that is not a configuration mistake anybody ' +
          'notices until it matters',
      );
    }
  }

  if (options.ingestToken === options.reviewToken) {
    throw new Error(
      'the ingest token and the review token are the same value, so this deployment has one ' +
        'secret and not two. The separation is the whole point: the ingest token lives in CI ' +
        'configuration, and approving promotes a baseline — anything that can read a build log ' +
        'would be able to approve a regression',
    );
  }
}

class BadRequest extends Error {
  override readonly name = 'BadRequest';
}

/** A valid token that is not the one this route wants. Never a 401 and never a 404. */
class Forbidden extends Error {
  override readonly name = 'Forbidden';
}

class MethodNotAllowed extends Error {
  override readonly name = 'MethodNotAllowed';
  constructor(
    message: string,
    readonly allow: string,
  ) {
    super(message);
  }
}

function requires(granted: Granted, needed: Granted, path: string): void {
  if (granted === needed) return;
  throw new Forbidden(
    `${path} is served to the ${needed} token and this request presented the ${granted} one. ` +
      (needed === 'review'
        ? 'Deciding promotes a baseline, so it is not something a build log can do'
        : 'Writing to this deployment is something CI does, not something a reviewer does'),
  );
}

function requireMethod(request: Request, method: string): void {
  if (request.method === method) return;
  throw new MethodNotAllowed(
    `this path is answered over ${method}, not ${request.method}`,
    method,
  );
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

async function asRecordBody(request: Request): Promise<Readonly<Record<string, unknown>>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch (error) {
    throw new BadRequest(
      `the request body is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return record(parsed, 'the request body');
}

function record(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequest(`${what} must be an object; received ${describe(value)}`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function asKey(value: unknown): { readonly subject: string; readonly label?: string } {
  const source = record(value, '`key`');
  const label = source['label'];
  if (label !== undefined && typeof label !== 'string') {
    throw new BadRequest('`key.label` must be a string when present');
  }
  return {
    subject: string(source, 'subject', '`key`'),
    ...(typeof label === 'string' ? { label } : {}),
  };
}

function asIdentity(value: unknown): ReturnType<typeof identityFrom> & object {
  const identity = identityFrom(value);
  if (identity === null) {
    // Never defaulted, and never partially rebuilt. An identity missing a field
    // is a different machine from the one that wrote the baseline, and inventing
    // the field would make a wrong-machine comparison look comparable.
    throw new BadRequest(
      '`identity` is not a renderer identity. Every field is required, because the identity is ' +
        'the partition that decides whether two images may be compared at all',
    );
  }
  return identity;
}

function asDecision(value: unknown): Decision {
  if (value !== 'approved' && value !== 'rejected') {
    throw new BadRequest(`\`decision\` must be "approved" or "rejected"; received ${describe(value)}`);
  }
  return value;
}

/**
 * A build, checked before any of it is stored.
 *
 * The report itself is handed to `review.ingest` as-is rather than rebuilt field
 * by field, and that is a deliberate asymmetry with the baseline routes. A
 * misread *response* becomes a verdict; a misread *request* becomes a 4xx nobody
 * mistakes for an answer. What is checked here is what the store would otherwise
 * crash on or silently mis-record — the version, and the shape of the wrapper.
 */
async function asBuildIngest(request: Request): Promise<BuildIngest> {
  const body = await asRecordBody(request);
  const report = record(body['report'], '`report`');

  if (report['runVersion'] !== 1) {
    throw new BadRequest(
      `\`report.runVersion\` must be 1; received ${describe(report['runVersion'])}. A report from ` +
        'a writer this deployment does not understand would be partly stored and wholly believed',
    );
  }
  if (!Array.isArray(report['observations'])) {
    throw new BadRequest('`report.observations` must be an array');
  }

  const branch = body['branch'];
  const images = body['images'];

  return {
    build: string(body, 'build', 'the build'),
    commit: string(body, 'commit', 'the build'),
    report: report as unknown as RunReport,
    ...(typeof branch === 'string' && branch !== '' ? { branch } : {}),
    ...(images === undefined || images === null
      ? {}
      : { images: record(images, '`images`') as Readonly<Record<string, SubjectImages>> }),
  };
}

function string(source: Readonly<Record<string, unknown>>, key: string, what: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value === '') {
    throw new BadRequest(`${what}.${key} must be a non-empty string; received ${describe(value)}`);
  }
  return value;
}

function required(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (value === null || value === '') {
    throw new BadRequest(`\`${name}\` is required on ${url.pathname}`);
  }
  return value;
}

function optional(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value === '' ? undefined : value;
}

function count(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequest(`a count must be a whole number of at least 0; received "${value}"`);
  }
  return parsed;
}

/**
 * The window, validated before it can quietly select nothing.
 *
 * An unparseable `since` would reach the query as `NaN`, bind as NULL, match no
 * row, and answer a churn of zero over zero runs — indistinguishable from a
 * component that has never changed. A limit of zero is refused for the same
 * reason: it asks for an answer computed over nothing, dressed as an answer.
 */
function windowOf(url: URL): Window {
  const since = optional(url, 'since');
  const until = optional(url, 'until');
  const limit = optional(url, 'limit');

  if (since !== undefined && Number.isNaN(Date.parse(since))) {
    throw new BadRequest(`\`since\` must be an ISO-8601 instant; received "${since}"`);
  }
  if (until !== undefined && Number.isNaN(Date.parse(until))) {
    throw new BadRequest(`\`until\` must be an ISO-8601 instant; received "${until}"`);
  }

  let parsedLimit: number | undefined;
  if (limit !== undefined) {
    parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      throw new BadRequest(
        `\`limit\` must be a whole number of at least 1; received "${limit}". A limit of 0 asks ` +
          'for a drift answer computed over no rows, which reads as stability',
      );
    }
  }

  return {
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
  };
}

/**
 * A write, validated completely before any of it is appended.
 *
 * The history store is append-only, so this is the last moment anything can be
 * refused. A row with an unknown band or an unparseable instant that gets in
 * stays in, and every later query over that window either throws or silently
 * misorders — so the strictness here is not politeness about input, it is the
 * only place the invariant can still be enforced.
 */
async function asRecordRequest(request: Request): Promise<{
  readonly run: RunRecord;
  readonly observations: readonly Observation[];
  readonly tokens: readonly TokenValue[];
}> {
  const body = await asRecordBody(request);

  return {
    run: asRunRecord(body['run']),
    observations: array(body['observations'], '`observations`').map((row, index) =>
      asObservation(row, `observations[${index}]`),
    ),
    tokens: array(body['tokens'], '`tokens`').map((row, index) =>
      asTokenValue(row, `tokens[${index}]`),
    ),
  };
}

function array(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new BadRequest(`${what} must be an array; received ${describe(value)}`);
  }
  return value as readonly unknown[];
}

function instant(source: Readonly<Record<string, unknown>>, key: string, what: string): string {
  const value = string(source, key, what);
  if (Number.isNaN(Date.parse(value))) {
    throw new BadRequest(
      `${what}.${key} must be an ISO-8601 instant; received "${value}". A row whose time cannot ` +
        'be parsed orders a journey wrongly, and a journey read backwards is a confident sentence ' +
        'that is exactly reversed',
    );
  }
  return value;
}

function flag(source: Readonly<Record<string, unknown>>, key: string, what: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    throw new BadRequest(`${what}.${key} must be a boolean; received ${describe(value)}`);
  }
  return value;
}

function asBand(value: unknown, what: string): Band {
  if (typeof value !== 'string' || !BANDS.includes(value as Band)) {
    throw new BadRequest(`${what} must be one of ${BANDS.join(', ')}; received ${describe(value)}`);
  }
  return value as Band;
}

/** Checked against `core`'s own table, so a tier added there needs no edit here. */
function asProfile(value: unknown, what: string): ProfileId {
  const known: unknown = typeof value === 'string' ? profileById(value as ProfileId) : undefined;
  if (known === undefined) {
    throw new BadRequest(`${what}.profile is not a known observation profile: ${describe(value)}`);
  }
  return value as ProfileId;
}

function asRunRecord(value: unknown): RunRecord {
  const what = '`run`';
  const source = record(value, what);
  return {
    project: string(source, 'project', what),
    run: string(source, 'run', what),
    commit: string(source, 'commit', what),
    profile: asProfile(source['profile'], what),
    at: instant(source, 'at', what),
  };
}

function asObservation(value: unknown, what: string): Observation {
  const source = record(value, what);
  const file = source['file'];

  if (file !== undefined && file !== null && typeof file !== 'string') {
    throw new BadRequest(`${what}.file must be a string when present; received ${describe(file)}`);
  }

  return {
    project: string(source, 'project', what),
    subject: string(source, 'subject', what),
    component: string(source, 'component', what),
    band: asBand(source['band'], `${what}.band`),
    hash: string(source, 'hash', what) as Digest,
    profile: asProfile(source['profile'], what),
    commit: string(source, 'commit', what),
    run: string(source, 'run', what),
    at: instant(source, 'at', what),
    accepted: flag(source, 'accepted', what),
    ...(typeof file === 'string' && file !== '' ? { file } : {}),
  };
}

function asTokenValue(value: unknown, what: string): TokenValue {
  const source = record(value, what);
  return {
    project: string(source, 'project', what),
    token: string(source, 'token', what),
    value: string(source, 'value', what),
    commit: string(source, 'commit', what),
    at: instant(source, 'at', what),
  };
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  return `${typeof value} (${String(value).slice(0, 60)})`;
}

/** Re-exported so a Worker entry can recognise a store failure without a second import. */
export { RasterStoreError };
