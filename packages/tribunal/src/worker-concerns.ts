import { CONCERN_STATES, type ConcernState } from './concern-types.js';
import { createConcernStore, type ConcernStore } from './concerns.js';
import type { D1Like } from './bindings.js';
import { readable, requires, type Granted } from './worker-auth.js';
import { BadRequest, MethodNotAllowed, asRecordBody, describe, json, optional, string } from './worker-http.js';

/**
 * The concern routes: what reviewers suspect about a render, beside whether its
 * baseline moves. The store and its reasons are in [`concerns.ts`](./concerns.ts).
 *
 * ```
 * GET  /review/concerns?build=&subject=&state=   → { concerns, tally? }
 * POST /review/concerns                          → 201 { concern }
 * POST /review/concerns/<id>                     → { concern }
 * ```
 *
 * ## A run may read them
 *
 * Writing is the review token's, as deciding is: a concern is a person saying
 * "this looks wrong". Reading is `readable`, the history routes' rule, because a
 * concern changes nothing a run depends on and a run is exactly what should be
 * told that the subject it is about to move is already under suspicion — an
 * agent holding CI's token included.
 */

/** Every route in this file is this path or under it, and nothing else in the router is. */
export const CONCERNS_PATH = '/review/concerns';

export type ConcernRoute = (granted: Granted, url: URL, request: Request) => Promise<Response>;

export function createConcernRoutes(options: {
  readonly db: D1Like;
  readonly project: string;
  readonly now?: () => Date;
}): ConcernRoute {
  const concerns: ConcernStore = createConcernStore(options);

  return async (granted, url, request) => {
    const path = url.pathname;

    if (path === CONCERNS_PATH && request.method === 'GET') {
      readable(granted, path);
      const build = optional(url, 'build');
      const subject = optional(url, 'subject');
      const state = optional(url, 'state');
      const found = await concerns.list({
        ...(build !== undefined ? { seenIn: build } : {}),
        ...(subject !== undefined ? { subject } : {}),
        ...(state !== undefined ? { state: stateOf(state) } : {}),
      });
      // The tally is over what the build showed, whatever the other filters
      // narrowed the list to, so a rail can count without a second request.
      return json(200, {
        concerns: found,
        ...(build !== undefined ? { tally: await concerns.tally(build) } : {}),
      });
    }

    if (path === CONCERNS_PATH) {
      requires(granted, 'review', path);
      if (request.method !== 'POST') {
        throw new MethodNotAllowed(`${path} is read with GET and raised with POST`, 'GET, POST');
      }
      const body = await asRecordBody(request);
      const concern = await concerns.raise({
        build: string(body, 'build', 'the concern'),
        subject: string(body, 'subject', 'the concern'),
        title: string(body, 'title', 'the concern'),
        by: string(body, 'by', 'the concern'),
        ...words(body),
        ...(body['region'] !== undefined ? { region: body['region'] as never } : {}),
        ...(body['evidence'] !== undefined ? { evidence: evidenceOf(body['evidence']) } : {}),
        ...(body['state'] !== undefined ? { state: stateOf(body['state']) } : {}),
      });
      return json(201, { concern });
    }

    const id = /^\/review\/concerns\/(\d+)$/.exec(path)?.[1];
    if (id === undefined) return json(404, { error: `no concern route ${path}` });
    requires(granted, 'review', path);
    if (request.method !== 'POST') {
      throw new MethodNotAllowed(`${path} is moved with POST`, 'POST');
    }
    const body = await asRecordBody(request);
    const concern = await concerns.move(Number(id), {
      state: stateOf(body['state']),
      by: string(body, 'by', 'the step'),
      ...words(body),
    });
    return json(200, { concern });
  };
}

function words(body: Readonly<Record<string, unknown>>): { note?: string; hypothesis?: string } {
  const out: { note?: string; hypothesis?: string } = {};
  for (const key of ['note', 'hypothesis'] as const) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') throw new BadRequest(`\`${key}\` must be a string; received ${describe(value)}`);
    if (value.trim() !== '') out[key] = value;
  }
  return out;
}

function stateOf(value: unknown): ConcernState {
  if (CONCERN_STATES.includes(value as ConcernState)) return value as ConcernState;
  throw new BadRequest(`\`state\` must be one of ${CONCERN_STATES.join(', ')}; received ${describe(value)}`);
}

function evidenceOf(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item !== '')) {
    throw new BadRequest(`\`evidence\` must be a list of non-empty strings; received ${describe(value)}`);
  }
  return value as readonly string[];
}
