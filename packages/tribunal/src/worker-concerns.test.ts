// The concern routes, through the whole handler: authentication, capability,
// validation and the store. The store's own rules are in
// [`concerns.test.ts`](./concerns.test.ts).

import { beforeEach, describe, expect, it } from 'vitest';
import { TRIBUNAL_API, createTribunal, type Tribunal } from './worker.js';
import { ingest } from './__fixtures__/review.js';
import { createMemoryR2, createSqliteD1 } from './testing.js';

const INGEST = 'ingest-token-0123456789';
const REVIEW = 'review-token-0123456789';
const SUBJECT = 'story:todos--populated';

let worker: Tribunal;

beforeEach(async () => {
  worker = createTribunal({
    db: await createSqliteD1(),
    bucket: createMemoryR2(),
    project: 'todomvc',
    ingestToken: INGEST,
    reviewToken: REVIEW,
  });
  expect((await call('/review/builds', { token: INGEST, body: ingest() })).status).toBe(201);
});

function call(path: string, init: { token?: string; method?: string; body?: unknown } = {}): Promise<Response> {
  return worker.fetch(
    new Request(`https://variance.example.com${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  );
}

const RAISE = { build: 'ci-1001', subject: SUBJECT, title: 'Total moved', by: 'marina' };

describe('the concern routes', () => {
  it('raises, moves and lists a concern for the review token', async () => {
    const raised = await call('/review/concerns', {
      token: REVIEW,
      body: { ...RAISE, region: { x: 0, y: 0, width: 1, height: 1 }, evidence: ['CartSummary.tsx:84'] },
    });
    expect(raised.status).toBe(201);
    const { concern } = (await raised.json()) as { concern: { id: number; state: string } };
    expect(concern.state).toBe('open');

    const moved = await call(`/review/concerns/${concern.id}`, {
      token: REVIEW,
      body: { state: 'resolved', by: 'anton', note: 'Intended' },
    });
    expect(moved.status).toBe(200);

    const listed = await call(`/review/concerns?build=ci-1001`, { token: REVIEW });
    const body = (await listed.json()) as { concerns: { state: string }[]; tally: unknown };
    expect(body.concerns.map((c) => c.state)).toEqual(['resolved']);
    expect(body.tally).toEqual({ open: 0, investigating: 0, resolved: 1 });
  });

  it('keeps concerns from the ingest token, read or written', async () => {
    // A concern is what a person wrote on the review surface, and reading that
    // surface is the review token's: the ingest token lives in CI, where anything
    // that dumps its environment prints it.
    await call('/review/concerns', { token: REVIEW, body: RAISE });

    const read = await call(`/review/concerns?subject=${encodeURIComponent(SUBJECT)}&state=open`, { token: REVIEW });
    expect(((await read.json()) as { concerns: unknown[] }).concerns).toHaveLength(1);

    expect((await call(`/review/concerns?subject=${encodeURIComponent(SUBJECT)}`, { token: INGEST })).status).toBe(403);
    expect((await call('/review/concerns', { token: INGEST, body: RAISE })).status).toBe(403);
    expect((await call('/review/concerns/1', { token: INGEST, body: { state: 'resolved', by: 'ci' } })).status).toBe(403);
  });

  it('reads a null region as the whole render', async () => {
    const raised = await call('/review/concerns', { token: REVIEW, body: { ...RAISE, region: null } });
    expect(raised.status).toBe(201);
    expect(((await raised.json()) as { concern: Record<string, unknown> }).concern).not.toHaveProperty('region');
  });

  it('answers a stranger as it answers every other path', async () => {
    expect((await call('/review/concerns')).status).toBe(401);
  });

  it('refuses a body it cannot read as a concern', async () => {
    expect((await call('/review/concerns', { token: REVIEW, body: { ...RAISE, title: '' } })).status).toBe(400);
    expect((await call('/review/concerns', { token: REVIEW, body: { ...RAISE, title: '   ' } })).status).toBe(400);
    expect((await call('/review/concerns', { token: REVIEW, body: { ...RAISE, region: { x: 0 } } })).status).toBe(400);
    expect((await call('/review/concerns', { token: REVIEW, body: { ...RAISE, region: 'all' } })).status).toBe(400);
    expect((await call('/review/concerns', { token: REVIEW, body: { ...RAISE, evidence: 'x' } })).status).toBe(400);
    expect((await call('/review/concerns', { token: REVIEW, body: { ...RAISE, state: 'closed' } })).status).toBe(400);
    expect((await call('/review/concerns/abc', { token: REVIEW, body: { state: 'open', by: 'm' } })).status).toBe(404);
  });

  it('answers a concern about a subject the build never showed as the caller’s problem', async () => {
    const response = await call('/review/concerns', { token: REVIEW, body: { ...RAISE, subject: 'story:nope' } });
    expect(response.status).toBe(422);
  });

  it('refuses a filter it does not know rather than answering everything', async () => {
    expect((await call('/review/concerns?state=closed', { token: REVIEW })).status).toBe(400);
  });

  it('says on /version that this deployment keeps concerns', async () => {
    expect(TRIBUNAL_API).toBe(4);
    const version = (await (await call('/version', { token: REVIEW })).json()) as { api: number; schema: number };
    expect(version.api).toBe(4);
    expect(version.schema).toBe(19);
  });
});
