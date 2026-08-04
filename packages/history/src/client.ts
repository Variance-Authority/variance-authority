import { profileById, type Digest, type ProfileId } from '@variance-authority/core';
import { BANDS, type Band, type Observation, type TokenValue } from './observation.js';
import {
  CHURN_PATH,
  LAST_CHANGED_PATH,
  OBSERVATIONS_PATH,
  REACH_PATH,
  VALUE_JOURNEY_PATH,
  type RecordRequest,
} from './protocol.js';
import type { BandChurn, Churn, HistoryStore, Journey, Reach, Window } from './store.js';

/**
 * The store, over a hop.
 *
 * The service is the operator's own — a process, a port, and a bearer token they
 * set — so this client is deliberately dull: JSON over HTTP, one path per
 * question, and no notion of identity beyond the token. What it is *not* dull
 * about is failure.
 *
 * **A transport failure throws. It never resolves to an empty result.** That is
 * the single rule this file exists to enforce. An unreachable service returning
 * an empty churn produces the sentence "nothing has drifted", which is a
 * confident answer to a question that was never asked, and the reader has no way
 * to tell it apart from a real one. The same applies one layer in: a 500, a 401,
 * a body that parses but is not the shape asked for — all of them throw, because
 * a `Churn` assembled from missing fields is a page of zeroes that looks exactly
 * like stability.
 *
 * The absence of a store is a different thing entirely, and is said differently:
 * see `createAbsentStore`.
 */

export interface HttpHistoryOptions {
  /** Base URL of the operator's service, e.g. `http://history.internal:7788`. */
  readonly endpoint: string;

  /**
   * The bearer token the operator configured on the service.
   *
   * The service holds no accounts and no identity of its own; everything it
   * stores was produced by runs the operator owns, and the token is how it
   * refuses a write it cannot attribute to one.
   */
  readonly token: string;

  /**
   * Scopes every query, and is checked against every row written.
   *
   * Optional because a single-project deployment does not need it, and dangerous
   * to omit on a shared one: unscoped queries blend two projects' `Button` into
   * one rate, and nothing in the answer would show it. When it is set, a write
   * carrying another project's rows throws rather than landing in the wrong
   * history.
   */
  readonly project?: string;

  /** Injected for tests, and for any caller with its own agent or proxy. */
  readonly fetch?: typeof globalThis.fetch;

  /** Milliseconds. A history query that hangs must fail, not stall the run. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createHttpHistoryStore(options: HttpHistoryOptions): HistoryStore {
  const send = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = options.endpoint.replace(/\/+$/, '');

  const query = async (
    path: string,
    params: Readonly<Record<string, string | number | undefined>>,
  ): Promise<unknown> => {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    if (options.project !== undefined) url.searchParams.set('project', options.project);

    return request(send, url.toString(), options.token, undefined, timeoutMs);
  };

  return {
    async record(run, observations, tokens): Promise<void> {
      if (options.project !== undefined) {
        const foreign = [
          ...(run.project === options.project ? [] : [run.project]),
          ...observations.filter((row) => row.project !== options.project).map((row) => row.project),
          ...tokens.filter((row) => row.project !== options.project).map((row) => row.project),
        ];
        if (foreign.length > 0) {
          throw new Error(
            `this client is scoped to project "${options.project}" but the write carries ` +
              `rows for ${[...new Set(foreign)].join(', ')}; a history written under the wrong ` +
              'project answers every later question about both of them wrongly',
          );
        }
      }

      const body: RecordRequest = { run, observations, tokens };
      await request(send, `${base}${OBSERVATIONS_PATH}`, options.token, body, timeoutMs);
    },

    async lastChanged(subject, component, band): Promise<Observation | null> {
      const url = `${base}${LAST_CHANGED_PATH}`;
      const body = await query(LAST_CHANGED_PATH, { subject, component, band });
      const source = asRecord(body, url, 'a last-changed response');
      const observation = source['observation'];

      return observation === null || observation === undefined
        ? null
        : asObservation(observation, url);
    },

    async churn(component, window): Promise<Churn> {
      return asChurn(
        await query(CHURN_PATH, { component, ...windowParams(window) }),
        `${base}${CHURN_PATH}`,
      );
    },

    async valueJourney(token, window): Promise<Journey> {
      return asJourney(
        await query(VALUE_JOURNEY_PATH, { token, ...windowParams(window) }),
        `${base}${VALUE_JOURNEY_PATH}`,
      );
    },

    async reach(component, window): Promise<Reach> {
      return asReach(
        await query(REACH_PATH, { component, ...windowParams(window) }),
        `${base}${REACH_PATH}`,
      );
    },
  };
}

function windowParams(window: Window): Readonly<Record<string, string | number | undefined>> {
  return {
    ...(window.since !== undefined ? { since: window.since } : {}),
    ...(window.until !== undefined ? { until: window.until } : {}),
    ...(window.limit !== undefined ? { limit: window.limit } : {}),
  };
}

async function request(
  send: typeof globalThis.fetch,
  url: string,
  token: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Typed off `send` rather than by naming the global `Response`, so this file
  // compiles under a `lib` that has no DOM in it (ADR-0001 keeps the DOM out).
  let response: Awaited<ReturnType<typeof send>>;
  try {
    response = await send(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
  } catch (error) {
    // The reason the message is this long: whoever reads it is about to decide
    // whether the product drifted, and the honest answer is that nobody knows.
    throw new Error(
      timedOut
        ? `history service ${url} did not answer within ${timeoutMs}ms; no drift question ` +
          'can be answered from a run that never reached the record'
        : `history service ${url} could not be reached (${reason(error)}); refusing to answer, ` +
          'because an empty history answer reads as "nothing has drifted"',
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `history service ${url} returned ${response.status}: ${await textOf(response)}`,
    );
  }

  // 204 is the normal answer to a write. A read that answers 204 falls through to
  // the shape checks below and is rejected there, which is right: an empty body
  // is not an empty history.
  if (body !== undefined && response.status === 204) return undefined;

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`history service ${url} returned a body that is not JSON`, { cause: error });
  }
}

async function textOf(response: Awaited<ReturnType<typeof globalThis.fetch>>): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '(no body)';
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Structural validation of every answer, before it becomes a number.
 *
 * Not paranoia about the operator's own service. A field missing from a JSON body
 * becomes `undefined`, `undefined` in an arithmetic sentence becomes `NaN`, and
 * `NaN` printed next to a component name is indistinguishable at a glance from a
 * finding. Failing at the boundary keeps a version mismatch between the client and
 * the service from turning into a plausible report.
 */
function asRecord(value: unknown, url: string, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`history service ${url} returned ${describe(value)} where ${what} was expected`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function asArray(value: unknown, url: string, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`history service ${url} returned ${describe(value)} where ${what} was expected`);
  }
  return value as readonly unknown[];
}

function text(
  source: Readonly<Record<string, unknown>>,
  key: string,
  url: string,
  what: string,
): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new Error(`history service ${url} returned ${what} whose \`${key}\` is ${describe(value)}`);
  }
  return value;
}

function count(
  source: Readonly<Record<string, unknown>>,
  key: string,
  url: string,
  what: string,
): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`history service ${url} returned ${what} whose \`${key}\` is ${describe(value)}`);
  }
  return value;
}

function flag(
  source: Readonly<Record<string, unknown>>,
  key: string,
  url: string,
  what: string,
): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    throw new Error(`history service ${url} returned ${what} whose \`${key}\` is ${describe(value)}`);
  }
  return value;
}

function optionalText(
  source: Readonly<Record<string, unknown>>,
  key: string,
  url: string,
  what: string,
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`history service ${url} returned ${what} whose \`${key}\` is ${describe(value)}`);
  }
  return value;
}

function asBand(value: unknown, url: string, what: string): Band {
  if (typeof value !== 'string' || !BANDS.includes(value as Band)) {
    throw new Error(`history service ${url} returned ${what} with an unknown band ${describe(value)}`);
  }
  return value as Band;
}

/**
 * Profile ids are checked against `core`'s own table rather than a list here.
 *
 * A literal list would go stale the day `core` gains a tier, and this client would
 * then reject rows the rest of the system considers valid. The assignment to
 * `unknown` is what makes the lookup's runtime miss visible: `profileById` is
 * typed total over `ProfileId`, and the value being checked is not one yet.
 */
function asProfile(value: unknown, url: string, what: string): ProfileId {
  const known: unknown =
    typeof value === 'string' ? profileById(value as ProfileId) : undefined;

  if (known === undefined) {
    throw new Error(
      `history service ${url} returned ${what} with an unknown profile ${describe(value)}`,
    );
  }
  return value as ProfileId;
}

function asObservation(value: unknown, url: string): Observation {
  const what = 'an observation';
  const source = asRecord(value, url, what);
  const file = optionalText(source, 'file', url, what);

  return {
    project: text(source, 'project', url, what),
    subject: text(source, 'subject', url, what),
    component: text(source, 'component', url, what),
    band: asBand(source['band'], url, what),
    hash: text(source, 'hash', url, what) as Digest,
    profile: asProfile(source['profile'], url, what),
    commit: text(source, 'commit', url, what),
    run: text(source, 'run', url, what),
    at: text(source, 'at', url, what),
    accepted: flag(source, 'accepted', url, what),
    ...(file !== undefined ? { file } : {}),
  };
}

function asTokenValue(value: unknown, url: string): TokenValue {
  const what = 'a token value';
  const source = asRecord(value, url, what);

  return {
    project: text(source, 'project', url, what),
    token: text(source, 'token', url, what),
    value: text(source, 'value', url, what),
    commit: text(source, 'commit', url, what),
    at: text(source, 'at', url, what),
  };
}

function asChurn(value: unknown, url: string): Churn {
  const what = 'a churn record';
  const source = asRecord(value, url, what);

  const bands = asArray(source['bands'], url, `${what}'s bands`).map((entry): BandChurn => {
    const band = asRecord(entry, url, 'a band churn');
    const profile = band['profile'];

    return {
      band: asBand(band['band'], url, 'a band churn'),
      ...(profile === undefined || profile === null
        ? {}
        : { profile: asProfile(profile, url, 'a band churn') }),
      runs: count(band, 'runs', url, 'a band churn'),
      changes: count(band, 'changes', url, 'a band churn'),
      rate: count(band, 'rate', url, 'a band churn'),
    };
  });

  const firstAt = optionalText(source, 'firstAt', url, what);
  const lastAt = optionalText(source, 'lastAt', url, what);

  return {
    component: text(source, 'component', url, what),
    window: asWindow(source['window'], url, what),
    runs: count(source, 'runs', url, what),
    changedRuns: count(source, 'changedRuns', url, what),
    bands,
    collateralRuns: count(source, 'collateralRuns', url, what),
    rejectedRuns: count(source, 'rejectedRuns', url, what),
    ...(firstAt !== undefined ? { firstAt } : {}),
    ...(lastAt !== undefined ? { lastAt } : {}),
    omittedRuns: count(source, 'omittedRuns', url, what),
    omittedObservations: count(source, 'omittedObservations', url, what),
  };
}

function asJourney(value: unknown, url: string): Journey {
  const what = 'a value journey';
  const source = asRecord(value, url, what);

  return {
    token: text(source, 'token', url, what),
    window: asWindow(source['window'], url, what),
    values: asArray(source['values'], url, `${what}'s values`).map((entry) =>
      asTokenValue(entry, url),
    ),
    // Required rather than defaulted to zero: a service that forgets to report
    // what it left out would make every truncated journey read as a whole one.
    omitted: count(source, 'omitted', url, what),
  };
}

function asReach(value: unknown, url: string): Reach {
  const what = 'a reach record';
  const source = asRecord(value, url, what);

  const strings = (key: string): readonly string[] =>
    asArray(source[key], url, `${what}'s ${key}`).map((entry) => {
      if (typeof entry !== 'string') {
        throw new Error(
          `history service ${url} returned ${what} whose \`${key}\` contains ${describe(entry)}`,
        );
      }
      return entry;
    });

  return {
    component: text(source, 'component', url, what),
    window: asWindow(source['window'], url, what),
    subjects: strings('subjects'),
    arrived: strings('arrived'),
    omittedSubjects: count(source, 'omittedSubjects', url, what),
  };
}

/** The window is echoed back so a caller can see the bounds the answer used. */
function asWindow(value: unknown, url: string, what: string): Window {
  if (value === undefined || value === null) return {};
  const source = asRecord(value, url, `${what}'s window`);

  const since = optionalText(source, 'since', url, what);
  const until = optionalText(source, 'until', url, what);
  const limit = source['limit'];

  return {
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(limit === undefined || limit === null
      ? {}
      : { limit: count(source, 'limit', url, what) }),
  };
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `${typeof value} (${JSON.stringify(value)?.slice(0, 80) ?? ''})`;
}
