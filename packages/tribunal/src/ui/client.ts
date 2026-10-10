import {
  CHURN_PATH,
  FLAKINESS_PATH,
  LAST_CHANGED_PATH,
  REACH_PATH,
  type Churn,
  type Flakiness,
  type Observation,
  type Reach,
  type Window,
} from '@variance-authority/history';
import type {
  BuildDetail,
  BuildSummary,
  Decision,
  DecisionRecord,
  SweepReport,
  TribunalChangelog,
  TribunalChangelogQuery,
} from '../review.js';
import type {
  Concern,
  ConcernQuery,
  ConcernTally,
  MoveConcern,
  RaiseConcern,
} from '../concern-types.js';

/**
 * The review API, as the browser sees it.
 *
 * Separate from the components so the surface can be driven by something that is
 * not React — a script, a terminal, another team's dashboard — and so the
 * components can be rendered against a fake without a server. Everything it
 * returns is the same shape `review.ts` produced, because the Worker serializes
 * those types directly rather than reshaping them for a viewer.
 *
 * ## Every non-2xx throws
 *
 * The same rule the baseline and history clients follow, for a weaker but real
 * version of the same reason. A list that answered `[]` to a 500 says "no builds
 * need review" — which is the sentence somebody merges on.
 */

export interface ReviewClientOptions {
  /**
   * Where the Worker is mounted, e.g. `https://variance.example.com` or `/api`.
   *
   * A relative base is the normal case behind the Next.js adapter, where the
   * page and the API are the same deployment and the browser has the session
   * anyway.
   */
  readonly endpoint: string;
  /**
   * The review token, when the caller holds it directly.
   *
   * Omit it behind the Next.js adapter: there the server route holds the token
   * and the browser never sees it, which is the entire reason that adapter exists.
   * A review token shipped to a browser is a token in everybody's devtools.
   */
  readonly token?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface ReviewClient {
  /**
   * Where this client is pointed, when it knows.
   *
   * Read by the one screen that has to name an address rather than use it: an
   * empty store, which answers with the `variance push` configuration that would
   * fill it. Optional because a fake stands in for the whole interface in tests,
   * and a list must not need an address to render.
   */
  readonly endpoint?: string;
  builds(limit?: number): Promise<readonly BuildSummary[]>;
  build(id: string): Promise<BuildDetail>;
  /** Why the baselines are what they are, grouped by shape. */
  changelog(query?: TribunalChangelogQuery): Promise<TribunalChangelog>;
  /**
   * The three history answers a reviewer needs to place one difference in time.
   *
   * They read the same rows `variance` writes and are served on the same paths a
   * CLI addresses — this deployment is one service, and the review page is a
   * second reader of the record rather than a second record. Never `Unkept`: a
   * tribunal that is answering at all has a database, and the sentence about
   * nobody keeping a record belongs to a pipeline with no service configured.
   */
  churn(component: string, window?: Window): Promise<Churn>;
  reach(component: string, window?: Window): Promise<Reach>;
  flakiness(subject: string, window?: Window): Promise<Flakiness>;
  /** The most recent recorded reading of one component in one subject, or `null`. */
  lastChanged(subject: string, component: string): Promise<Observation | null>;
  /**
   * Record a decision. `baselineVersion` is the subject's
   * `SubjectView.baselineVersion` as the page read it: given, the service
   * answers 409 when the baseline has moved since; omitted, it checks nothing.
   */
  decide(
    build: string,
    subject: string,
    decision: Decision,
    by: string,
    note?: string,
    baselineVersion?: string | null,
  ): Promise<DecisionRecord>;
  sweep(days?: number): Promise<SweepReport>;
  /**
   * What reviewers suspect, apart from what they decided.
   *
   * `seenIn` reads every concern on a subject that build showed, whichever build
   * raised it, and brings the build's tally with it; without it there is no
   * build to count over and `tally` is absent.
   */
  concerns(query?: ConcernQuery): Promise<{ readonly concerns: readonly Concern[]; readonly tally?: ConcernTally }>;
  raise(input: RaiseConcern): Promise<Concern>;
  moveConcern(id: number, input: MoveConcern): Promise<Concern>;
  /** The URL of one image, for an `<img src>`. Never fetched here. */
  imageUrl(build: string, subject: string, kind: 'before' | 'after' | 'diff'): string;
  /**
   * The bytes of one image, for a reader that needs pixels rather than a frame.
   *
   * `imageUrl` is enough for everything the surface *displays*, because an
   * `<img>` carries the host's capability on its own. The difference mask is the
   * one thing the page computes rather than displays — a build pushed by a
   * current CLI does not upload one — and computing it means decoding two
   * images, which means holding them. Same route, same credential, one place.
   */
  imageBlob(build: string, subject: string, kind: 'before' | 'after' | 'diff'): Promise<Blob>;
}

/**
 * The two baselines a refused decision was caught between: the one the page read
 * and the one standing now, each the document it was painted from, `null` for
 * none. The service's 409 carries them beside its sentence.
 */
export interface MovedBaseline {
  readonly read: string | null;
  readonly current: string | null;
}

export class ReviewRequestError extends Error {
  override readonly name = 'ReviewRequestError';
  constructor(
    message: string,
    readonly status: number,
    /** What moved, when the refusal was a baseline that moved under the decision. */
    readonly moved?: MovedBaseline,
  ) {
    super(message);
  }
}

/**
 * A review client over `fetch`, pointed at wherever the service is mounted.
 *
 * The one dependency {@link ReviewApp} has. Everything non-2xx throws
 * {@link ReviewRequestError} with the status, so a failure reaches the surface
 * as a failure rather than as an empty list somebody merges on.
 */
export function createReviewClient(options: ReviewClientOptions): ReviewClient {
  const base = options.endpoint.replace(/\/$/, '');
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;

    const response = await send(`${base}${path}`, { ...init, headers });
    if (!response.ok) {
      const body = await read(response);
      const moved = movedIn(body);
      throw new ReviewRequestError(
        `${init?.method ?? 'GET'} ${path} answered ${response.status}: ${quote(body)}`,
        response.status,
        moved,
      );
    }
    return (await response.json()) as T;
  }

  const encode = (value: string): string => encodeURIComponent(value);

  return {
    endpoint: base,

    async builds(limit): Promise<readonly BuildSummary[]> {
      const body = await call<{ readonly builds: readonly BuildSummary[] }>(
        `/review/builds${limit === undefined ? '' : `?limit=${limit}`}`,
      );
      return body.builds;
    },

    build: (id) => call<BuildDetail>(`/review/builds/${encode(id)}`),

    changelog: (query = {}) =>
      call<TribunalChangelog>(
        `/review/changelog${search({
          component: query.component,
          subject: query.subject,
          since: query.since,
          limit: query.limit,
        })}`,
      ),

    churn: (component, window) =>
      call<Churn>(`${CHURN_PATH}${search({ component, ...window })}`),

    reach: (component, window) =>
      call<Reach>(`${REACH_PATH}${search({ component, ...window })}`),

    flakiness: (subject, window) =>
      call<Flakiness>(`${FLAKINESS_PATH}${search({ subject, ...window })}`),

    async lastChanged(subject, component): Promise<Observation | null> {
      const body = await call<{ readonly observation: Observation | null }>(
        `${LAST_CHANGED_PATH}${search({ subject, component })}`,
      );
      return body.observation;
    },

    decide: (build, subject, decision, by, note, baselineVersion) =>
      call<DecisionRecord>(`/review/builds/${encode(build)}/subjects/${encode(subject)}/decision`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          by,
          ...(note === undefined ? {} : { note }),
          ...(baselineVersion === undefined ? {} : { baselineVersion }),
        }),
      }),

    sweep: (days) =>
      call<SweepReport>(`/review/sweep${days === undefined ? '' : `?days=${days}`}`, {
        method: 'POST',
      }),

    concerns: (query = {}) =>
      call<{ readonly concerns: readonly Concern[]; readonly tally?: ConcernTally }>(
        `/review/concerns${search({ build: query.seenIn, subject: query.subject, state: query.state })}`,
      ),

    async raise(input): Promise<Concern> {
      const body = await call<{ readonly concern: Concern }>('/review/concerns', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return body.concern;
    },

    async moveConcern(id, input): Promise<Concern> {
      const body = await call<{ readonly concern: Concern }>(`/review/concerns/${id}`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return body.concern;
    },

    imageUrl: (build, subject, kind) =>
      `${base}/review/builds/${encode(build)}/subjects/${encode(subject)}/${kind}.png`,

    async imageBlob(build, subject, kind): Promise<Blob> {
      const path = `/review/builds/${encode(build)}/subjects/${encode(subject)}/${kind}.png`;
      const response = await send(
        `${base}${path}`,
        options.token === undefined
          ? {}
          : { headers: { authorization: `Bearer ${options.token}` } },
      );
      if (!response.ok) {
        throw new ReviewRequestError(
          `GET ${path} answered ${response.status}: ${quote(await read(response))}`,
          response.status,
        );
      }
      return await response.blob();
    },
  };
}

/**
 * A query string from the parameters that were actually given.
 *
 * An absent filter is left out rather than sent empty, because on these routes
 * the two mean different things: `component=` is a component whose name is the
 * empty string and matches nothing, while no `component` at all is the whole
 * project. A filter that silently narrows an answer to nothing is the same defect
 * as an empty list returned for a failure.
 */
function search(parameters: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
}

/**
 * What moved, when the body is the 409 a decision about a moved baseline gets.
 *
 * Read from the whole body rather than the quoted excerpt: a sentence naming a
 * long subject runs past the excerpt, and a cut body parses as nothing.
 */
function movedIn(body: string): MovedBaseline | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A body that is not JSON names nothing that moved; the message quotes it.
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { read, current } = parsed as Record<string, unknown>;
  return digestOrNone(read) && digestOrNone(current) ? { read, current } : undefined;
}

function digestOrNone(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** The body, or a placeholder saying why there is none. */
async function read(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<body could not be read>';
  }
}

/** The server's own sentence, quoted, because it is the one worth reading. */
function quote(body: string): string {
  return body.trim() === '' ? '<no body>' : body.slice(0, 500);
}
