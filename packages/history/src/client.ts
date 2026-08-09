import {
  asArray,
  asChurn,
  asFlakiness,
  asJourney,
  asObservation,
  asReach,
  asRecord,
} from './answers.js';
import type { Observation } from './observation.js';
import {
  CHURN_PATH,
  CURRENT_PATH,
  FLAKINESS_PATH,
  LAST_CHANGED_PATH,
  MAX_CURRENT_SUBJECTS,
  OBSERVATIONS_PATH,
  REACH_PATH,
  VALUE_JOURNEY_PATH,
  type CurrentRequest,
  type RecordRequest,
} from './protocol.js';
import type { Churn, Flakiness, HistoryStore, Journey, Reach, Window } from './store.js';

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
    async record(run, observations, tokens, instabilities): Promise<void> {
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

      const body: RecordRequest = {
        run,
        observations,
        tokens,
        ...(instabilities === undefined ? {} : { instabilities }),
      };
      await request(send, `${base}${OBSERVATIONS_PATH}`, options.token, body, timeoutMs);
    },

    async current(subjects): Promise<readonly Observation[]> {
      const url = `${base}${CURRENT_PATH}${
        options.project === undefined ? '' : `?project=${encodeURIComponent(options.project)}`
      }`;
      const rows: Observation[] = [];

      // Sequential, not concurrent. The answers are disjoint by subject so the
      // order does not matter, but a run that opens fifteen sockets at once
      // against the operator's single-process store trades a few hundred
      // milliseconds for the chance of timing out the write that follows.
      for (const batch of batched(subjects, MAX_CURRENT_SUBJECTS)) {
        const body: CurrentRequest = { subjects: batch };
        const answer = asRecord(
          await request(send, url, options.token, body, timeoutMs),
          url,
          'a current-rows response',
        );

        for (const row of asArray(answer['observations'], url, 'the current rows')) {
          rows.push(asObservation(row, url));
        }
      }

      return rows;
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

    async flakiness(subject, window): Promise<Flakiness> {
      return asFlakiness(
        await query(FLAKINESS_PATH, { subject, ...windowParams(window) }),
        `${base}${FLAKINESS_PATH}`,
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

/**
 * The subject list in request-sized pieces, de-duplicated on the way.
 *
 * A repeated subject would be answered twice and folded twice, which is harmless
 * arithmetically and is exactly the sort of harmlessness that stops being true
 * later. An empty list yields nothing at all, so a run with no subjects makes no
 * request rather than asking the store about nobody.
 */
function batched(subjects: readonly string[], size: number): readonly (readonly string[])[] {
  const unique = [...new Set(subjects)];
  const batches: string[][] = [];

  for (let index = 0; index < unique.length; index += size) {
    batches.push(unique.slice(index, index + size));
  }

  return batches;
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
