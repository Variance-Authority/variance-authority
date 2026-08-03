import type { BuildDetail, BuildSummary, Decision, DecisionRecord, SweepReport } from '../review.js';

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
  builds(limit?: number): Promise<readonly BuildSummary[]>;
  build(id: string): Promise<BuildDetail>;
  decide(
    build: string,
    subject: string,
    decision: Decision,
    by: string,
    note?: string,
  ): Promise<DecisionRecord>;
  sweep(days?: number): Promise<SweepReport>;
  /** The URL of one image, for an `<img src>`. Never fetched here. */
  imageUrl(build: string, subject: string, kind: 'before' | 'after' | 'diff'): string;
}

export class ReviewRequestError extends Error {
  override readonly name = 'ReviewRequestError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createReviewClient(options: ReviewClientOptions): ReviewClient {
  const base = options.endpoint.replace(/\/$/, '');
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;

    const response = await send(`${base}${path}`, { ...init, headers });
    if (!response.ok) {
      throw new ReviewRequestError(
        `${init?.method ?? 'GET'} ${path} answered ${response.status}: ${await quote(response)}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  const encode = (value: string): string => encodeURIComponent(value);

  return {
    async builds(limit): Promise<readonly BuildSummary[]> {
      const body = await call<{ readonly builds: readonly BuildSummary[] }>(
        `/review/builds${limit === undefined ? '' : `?limit=${limit}`}`,
      );
      return body.builds;
    },

    build: (id) => call<BuildDetail>(`/review/builds/${encode(id)}`),

    decide: (build, subject, decision, by, note) =>
      call<DecisionRecord>(`/review/builds/${encode(build)}/subjects/${encode(subject)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, by, ...(note === undefined ? {} : { note }) }),
      }),

    sweep: (days) =>
      call<SweepReport>(`/review/sweep${days === undefined ? '' : `?days=${days}`}`, {
        method: 'POST',
      }),

    imageUrl: (build, subject, kind) =>
      `${base}/review/builds/${encode(build)}/subjects/${encode(subject)}/${kind}.png`,
  };
}

/** The server's own sentence, quoted, because it is the one worth reading. */
async function quote(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim() === '' ? '<no body>' : text.slice(0, 500);
  } catch {
    return '<body could not be read>';
  }
}
