import { beforeEach, describe, expect, it } from 'vitest';
import { createTribunal, type Tribunal } from './worker.js';
import { createMemoryR2, createSqliteD1, type MemoryR2, type SqliteD1 } from './testing.js';

/**
 * Every path the history protocol defines, served by this deployment.
 *
 * Split from [`worker.test.ts`](./worker.test.ts) because the questions differ:
 * that file asks whether the routes are the ones the clients address and whether
 * the capabilities hold, and this one asks whether a run pointed at a tribunal
 * for history gets the same record it would get from
 * `@variance-authority/server`. Three of these routes were unserved and two
 * fields were dropped on the way in, and none of it presented as an error — a
 * missing `current` is every component reading as new, a missing `approvals` is
 * every component reading as never changed, and a dropped `swept` is a flake rate
 * with no denominator. Silence in all three directions, and all three of them
 * sound like a stable suite.
 */

const INGEST = 'ingest-token-0123456789';
const REVIEW = 'review-token-0123456789';

let db: SqliteD1;
let bucket: MemoryR2;
let worker: Tribunal;

beforeEach(async () => {
  db = await createSqliteD1();
  bucket = createMemoryR2();
  worker = createTribunal({
    db,
    bucket,
    project: 'todomvc',
    ingestToken: INGEST,
    reviewToken: REVIEW,
  });
});

function call(
  path: string,
  init: { token?: string; method?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token !== undefined) headers['authorization'] = `Bearer ${init.token}`;

  return worker.fetch(
    new Request(`https://variance.example.com${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  );
}

describe('the whole history protocol, not the half a run happens to call first', () => {
  const run = (id: string, extra: Record<string, unknown> = {}) => ({
    project: 'todomvc',
    run: id,
    commit: `c-${id}`,
    profile: 'chromium',
    at: '2026-06-01T00:00:00.000Z',
    ...extra,
  });

  const observation = (id: string, hash: string) => ({
    project: 'todomvc',
    subject: 'story:card',
    component: 'Button',
    band: 'style',
    hash,
    profile: 'chromium',
    commit: `c-${id}`,
    run: id,
    at: '2026-06-01T00:00:00.000Z',
    accepted: false,
  });

  it('answers what a subject last read, so the next run can tell a change from a first sighting', async () => {
    await call('/v1/observations', {
      token: INGEST,
      body: { run: run('r-1'), observations: [observation('r-1', 'aaaa')], tokens: [] },
    });

    const current = (await (
      await call('/v1/current?project=todomvc', {
        token: INGEST,
        body: { subjects: ['story:card'] },
      })
    ).json()) as { observations: readonly { hash: string }[] };

    // Without this route a run has nothing to compare against, so every
    // component it reads is "new" and drift is never detected — the failure is
    // silent and looks like a stable suite.
    expect(current.observations.map((row) => row.hash)).toEqual(['aaaa']);
  });

  it('refuses a subject list longer than one request may carry rather than answering the first 200', async () => {
    const response = await call('/v1/current', {
      token: INGEST,
      body: { subjects: Array.from({ length: 201 }, (_, index) => `story:${index}`) },
    });

    // A trimmed answer is worse than no answer: a missing previous row is
    // indistinguishable from a hash never recorded, so the run appends a change
    // that did not happen to a store that does not forget.
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/splits its list/);
  });

  it('records an approval, which is the only way churn learns anything shipped', async () => {
    await call('/v1/observations', {
      token: INGEST,
      body: { run: run('r-1'), observations: [observation('r-1', 'aaaa')], tokens: [] },
    });
    await call('/v1/observations', {
      token: INGEST,
      body: { run: run('r-2'), observations: [observation('r-2', 'bbbb')], tokens: [] },
    });

    expect(
      (
        await call('/v1/approvals', {
          token: INGEST,
          body: {
            approvals: [
              {
                project: 'todomvc',
                subject: 'story:card',
                run: 'r-2',
                at: '2026-06-02T00:00:00.000Z',
                by: 'marina',
              },
            ],
          },
        })
      ).status,
    ).toBe(204);

    const churn = (await (
      await call('/v1/churn?project=todomvc&component=Button', { token: REVIEW })
    ).json()) as { changedRuns: number };

    // Every observation is written unapproved — a run has not been reviewed at
    // the moment it writes — so a deployment that could not take approvals
    // answers "never changed" about a component that changed every week.
    expect(churn.changedRuns).toBe(1);
  });

  it('keeps an instability and the sweep that looked for it, which are the two halves of a rate', async () => {
    const recorded = await call('/v1/observations', {
      token: INGEST,
      body: {
        run: run('r-1', { swept: true }),
        observations: [observation('r-1', 'aaaa')],
        tokens: [],
        instabilities: [
          {
            project: 'todomvc',
            subject: 'story:card',
            component: 'Button',
            band: 'texture',
            profile: 'chromium',
            commit: 'c-r-1',
            run: 'r-1',
            at: '2026-06-01T00:00:00.000Z',
          },
        ],
      },
    });

    expect(recorded.status).toBe(204);

    const flakiness = (await (
      await call('/v1/flakiness?project=todomvc&subject=story:card', { token: REVIEW })
    ).json()) as { occurrences: number; sweeps: number; rate?: number };

    expect(flakiness).toMatchObject({ occurrences: 1, sweeps: 1, rate: 1 });
  });

  it('reports no rate at all when nothing ever read the subject twice', async () => {
    await call('/v1/observations', {
      token: INGEST,
      body: { run: run('r-1'), observations: [observation('r-1', 'aaaa')], tokens: [] },
    });

    const flakiness = (await (
      await call('/v1/flakiness?project=todomvc&subject=story:card', { token: REVIEW })
    ).json()) as { sweeps: number; rate?: number };

    // `swept` absent must not become `swept: false` on the way in, and no sweep
    // must not become a rate of zero: one says nobody looked and the other says
    // somebody looked and found nothing.
    expect(flakiness.sweeps).toBe(0);
    expect(flakiness.rate).toBeUndefined();
  });

  it('refuses an instability whose component is an empty string', async () => {
    const response = await call('/v1/observations', {
      token: INGEST,
      body: {
        run: run('r-3'),
        observations: [],
        tokens: [],
        instabilities: [
          {
            project: 'todomvc',
            subject: 'story:card',
            component: '',
            profile: 'chromium',
            commit: 'c-r-3',
            run: 'r-3',
            at: '2026-06-01T00:00:00.000Z',
          },
        ],
      },
    });

    // Stored, it comes back as a component named "" — a claim about the page
    // rather than about the collector that could not name one.
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/non-empty string when present/);
  });

  it('lets the review token read a derived answer and never write one', async () => {
    // The browser drawing a review page holds this token, and a reviewer needs
    // the history to know whether the difference in front of them is the third
    // this week or the first this year.
    for (const path of [
      '/v1/churn?component=Button',
      '/v1/reach?component=Button',
      '/v1/flakiness?subject=story:card',
      '/v1/value-journey?token=colour.brand',
      '/v1/last-changed?subject=story:card&component=Button',
    ]) {
      expect((await call(path, { token: REVIEW })).status).toBe(200);
    }

    for (const [path, body] of [
      ['/v1/observations', { run: run('r-9'), observations: [], tokens: [] }],
      ['/v1/approvals', { approvals: [] }],
      ['/v1/current', { subjects: ['story:card'] }],
    ] as const) {
      expect((await call(path, { token: REVIEW, body })).status).toBe(403);
    }
  });
});
