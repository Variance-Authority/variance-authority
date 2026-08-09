import { afterEach, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core';
import {
  CHURN_PATH,
  CURRENT_PATH,
  LAST_CHANGED_PATH,
  MAX_CURRENT_SUBJECTS,
  OBSERVATIONS_PATH,
  REACH_PATH,
  VALUE_JOURNEY_PATH,
  isKept,
  observationsFrom,
  type Observation,
  type RunRecord,
  type TokenValue,
} from '@variance-authority/history';
import { createHttpHistoryStore } from '@variance-authority/history/client';
import { createSqliteBackend } from './backend-sqlite.js';
import { lastChangedFrom, type HistoryBackend } from './backend.js';
import { serveHistory, type HistoryService } from './http.js';

/**
 * The socket, and the two things it is allowed to say to a stranger.
 *
 * The auth tests below are not box-ticking. A history service holds every
 * observation an operator's runs ever produced — subject names, component names,
 * file paths — so the interesting question is not whether a bad token is refused
 * but whether the refusal *says anything*. A 404 for an unknown path and a 401
 * for a known one is a map of the API handed to somebody holding nothing.
 *
 * The round trip is run through the real client from `@variance-authority/history`
 * rather than through hand-written fetches, because the failure worth catching is
 * the two halves of one protocol drifting apart. A field this service renames is
 * a field the client rejects, and a test that spoke the service's own dialect
 * back to it would pass through that.
 */

const TOKEN = 'a-very-long-operator-token';

const services: HistoryService[] = [];
const backends: HistoryBackend[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const backend of backends.splice(0)) await backend.close();
});

async function serve(): Promise<{ url: string; backend: HistoryBackend }> {
  const backend = createSqliteBackend({ path: ':memory:' });
  backends.push(backend);
  const service = await serveHistory({ backend, token: TOKEN });
  services.push(service);
  return { url: service.url, backend };
}

function run(fields: Partial<RunRecord> = {}): RunRecord {
  return {
    project: 'shop',
    run: 'run-1',
    commit: 'aaaa',
    profile: 'chromium',
    at: '2026-03-01T10:00:00.000Z',
    ...fields,
  } as RunRecord;
}

function observation(fields: Partial<Observation> = {}): Observation {
  return {
    project: 'shop',
    subject: 'checkout',
    component: 'Button',
    band: 'structure',
    hash: 'h-1' as Digest,
    profile: 'chromium',
    commit: 'aaaa',
    run: 'run-1',
    at: '2026-03-01T10:00:00.000Z',
    accepted: true,
    file: 'src/Button.tsx',
    ...fields,
  } as Observation;
}

function token(fields: Partial<TokenValue> = {}): TokenValue {
  return {
    project: 'shop',
    token: '--va-space-3',
    value: '12px',
    commit: 'aaaa',
    at: '2026-03-01T10:00:00.000Z',
    ...fields,
  } as TokenValue;
}

const authorized = { authorization: `Bearer ${TOKEN}` };

describe('authentication', () => {
  it('refuses a request with no token and one with a wrong token identically', async () => {
    // Any difference between the two is a signal that a token was *nearly* right.
    const { url } = await serve();
    const path = `${url}${LAST_CHANGED_PATH}?subject=checkout&component=Button`;

    const missing = await fetch(path);
    const wrong = await fetch(path, { headers: { authorization: 'Bearer nearly-the-token' } });

    expect([missing.status, wrong.status]).toEqual([401, 401]);
    expect(await missing.json()).toEqual(await wrong.json());
    expect(missing.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('answers an unknown path to an unauthenticated caller exactly as it answers a real one', async () => {
    // Authentication happens before routing. A 404 here would tell somebody
    // holding no token which paths this service serves; on a subject query it
    // would tell them the subject exists.
    const { url } = await serve();

    const real = await fetch(`${url}${CHURN_PATH}?component=Button`);
    const imaginary = await fetch(`${url}/v1/there-is-no-such-route`);

    expect([real.status, imaginary.status]).toEqual([401, 401]);
    expect(await real.json()).toEqual(await imaginary.json());
  });

  it('reveals the route list only to a caller that authenticated', async () => {
    const { url } = await serve();
    const response = await fetch(`${url}/v1/there-is-no-such-route`, { headers: authorized });

    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).toContain(OBSERVATIONS_PATH);
  });

  it('refuses to start at all with an empty token', async () => {
    // A service listening without authentication is worse than one that will not
    // start: it works, and nothing about it looks wrong.
    const backend = createSqliteBackend({ path: ':memory:' });
    backends.push(backend);

    await expect(serveHistory({ backend, token: '  ' })).rejects.toThrow(/not authenticated/);
  });
});

describe('malformed requests', () => {
  it('names the missing field rather than answering "Bad Request"', async () => {
    const { url } = await serve();
    const response = await fetch(`${url}${OBSERVATIONS_PATH}`, {
      method: 'POST',
      headers: { ...authorized, 'content-type': 'application/json' },
      body: JSON.stringify({ observations: [], tokens: [] }),
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('`run`');
  });

  it('reports a body that is not JSON as such', async () => {
    const { url } = await serve();
    const response = await fetch(`${url}${OBSERVATIONS_PATH}`, {
      method: 'POST',
      headers: { ...authorized, 'content-type': 'application/json' },
      body: 'this is not json',
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('not JSON');
  });

  it('refuses a row with an unknown band and stores nothing from that write', async () => {
    // The store is append-only, so the request boundary is the last moment
    // anything can be refused. A bad row that gets in stays in.
    const { url, backend } = await serve();
    const response = await fetch(`${url}${OBSERVATIONS_PATH}`, {
      method: 'POST',
      headers: { ...authorized, 'content-type': 'application/json' },
      body: JSON.stringify({
        run: run(),
        observations: [{ ...observation(), band: 'colour' }],
        tokens: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('structure, style, geometry');
    expect(await lastChangedFrom(backend, 'shop', 'checkout', 'Button')).toBeNull();
    expect((await backend.runsIn({ project: 'shop' })).rows).toHaveLength(0);
  });

  it('refuses an unparseable window bound instead of answering over no rows', async () => {
    // The alternative is a churn of zero over zero runs, which is what a
    // component that has never changed also looks like.
    const { url } = await serve();
    const response = await fetch(`${url}${CHURN_PATH}?component=Button&since=last%20tuesday`, {
      headers: authorized,
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('ISO-8601');
  });

  it('refuses a limit of zero, which asks for a drift answer computed over nothing', async () => {
    const { url } = await serve();
    const response = await fetch(`${url}${VALUE_JOURNEY_PATH}?token=--x&limit=0`, {
      headers: authorized,
    });

    expect(response.status).toBe(400);
  });

  it('answers a GET against the write route with 405 rather than 404', async () => {
    // 404 would send whoever wrote the client hunting for a typo in a path that
    // is correct.
    const { url } = await serve();
    const response = await fetch(`${url}${OBSERVATIONS_PATH}`, { headers: authorized });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('refuses a second write claiming a different commit for one run id with 409', async () => {
    // A client mistake, answered as one: reporting it as a 500 sends the operator
    // to inspect a database that is behaving correctly.
    const { url } = await serve();
    const write = async (commit: string): Promise<Response> =>
      fetch(`${url}${OBSERVATIONS_PATH}`, {
        method: 'POST',
        headers: { ...authorized, 'content-type': 'application/json' },
        body: JSON.stringify({ run: run({ commit }), observations: [], tokens: [] }),
      });

    expect((await write('aaaa')).status).toBe(204);
    expect((await write('bbbb')).status).toBe(409);
  });
});

describe('the wire, spoken by the real client', () => {
  it('carries a write and every question back unchanged', async () => {
    const { url } = await serve();
    const store = createHttpHistoryStore({ endpoint: url, token: TOKEN, project: 'shop' });

    const row = observation();
    await store.record(run(), [row], [token()]);

    const last = await store.lastChanged('checkout', 'Button');
    expect(isKept(last) ? last : null).toEqual(row);

    const churn = await store.churn('Button', {});
    expect(isKept(churn) && [churn.runs, churn.changedRuns]).toEqual([1, 1]);

    const journey = await store.valueJourney('--va-space-3', {});
    expect(isKept(journey) && journey.values.map((value) => value.value)).toEqual(['12px']);

    const reach = await store.reach('Button', {});
    expect(isKept(reach) && reach.subjects).toEqual(['checkout']);
  });

  it('reports a limit in the answer rather than returning a quietly shorter history', async () => {
    // The rule this service is least allowed to break: a capped answer that does
    // not say it was capped reads as a complete one, and a drift total over a
    // truncated window is a lower bound its reader will treat as the whole.
    const { url } = await serve();
    const store = createHttpHistoryStore({ endpoint: url, token: TOKEN, project: 'shop' });

    for (const index of [1, 2, 3, 4]) {
      const at = `2026-03-0${index}T10:00:00.000Z`;
      await store.record(
        run({ run: `r${index}`, commit: `c${index}`, at }),
        [observation({ run: `r${index}`, commit: `c${index}`, at, hash: `h${index}` as Digest })],
        [token({ commit: `c${index}`, at, value: `${10 + index * 2}px` })],
      );
    }

    const journey = await store.valueJourney('--va-space-3', { limit: 2 });
    expect(isKept(journey) && journey.omitted).toBe(2);

    const churn = await store.churn('Button', { limit: 2 });
    expect(isKept(churn) && [churn.runs, churn.omittedRuns]).toEqual([2, 2]);
  });

  it('scopes a query to one project when the client is scoped to one', async () => {
    // An unscoped query on a shared deployment blends two products' `Button` into
    // one rate, and nothing in the answer would show it.
    const { url } = await serve();
    const shop = createHttpHistoryStore({ endpoint: url, token: TOKEN, project: 'shop' });
    const admin = createHttpHistoryStore({ endpoint: url, token: TOKEN, project: 'admin' });

    await shop.record(run(), [observation()], []);
    await admin.record(
      run({ project: 'admin', run: 'other' }),
      [observation({ project: 'admin', run: 'other', subject: 'users' })],
      [],
    );

    const shopReach = await shop.reach('Button', {});
    const adminReach = await admin.reach('Button', {});
    expect(isKept(shopReach) && shopReach.subjects).toEqual(['checkout']);
    expect(isKept(adminReach) && adminReach.subjects).toEqual(['users']);
  });

  it('makes a broken answer a thrown error, never an empty history', async () => {
    // The client's rule, asserted from this side: a 401 must not be able to
    // become the sentence "nothing has drifted".
    const { url } = await serve();
    const store = createHttpHistoryStore({ endpoint: url, token: 'wrong-token-entirely' });

    await expect(store.churn('Button', {})).rejects.toThrow(/401/);
  });

  it('reports the arrival of a component in subjects it did not appear in before', async () => {
    const { url } = await serve();
    const store = createHttpHistoryStore({ endpoint: url, token: TOKEN, project: 'shop' });

    const before = '2026-01-05T10:00:00.000Z';
    await store.record(
      run({ run: 'r0', commit: 'c0', at: before }),
      [observation({ run: 'r0', commit: 'c0', at: before })],
      [],
    );
    const inside = '2026-02-05T10:00:00.000Z';
    await store.record(
      run({ run: 'r1', commit: 'c1', at: inside }),
      [
        observation({ run: 'r1', commit: 'c1', at: inside }),
        observation({ run: 'r1', commit: 'c1', at: inside, subject: 'settings' }),
      ],
      [],
    );

    const reach = await store.reach('Button', { since: '2026-02-01T00:00:00.000Z' });
    expect(isKept(reach) && reach.subjects).toEqual(['checkout', 'settings']);
    expect(isKept(reach) && reach.arrived).toEqual(['settings']);
  });

  it('answers the read a run makes before it writes, so only movement is written', async () => {
    // The round trip the whole record depends on. Without it the write rule — a
    // row only when a hash moves — is unimplementable, which is why this code sat
    // built and unreachable with nothing crossing the wire.
    const { url } = await serve();
    const store = createHttpHistoryStore({ endpoint: url, token: TOKEN, project: 'shop' });

    await store.record(run(), [observation()], []);

    const current = await store.current(['checkout']);
    expect(isKept(current)).toBe(true);
    expect(isKept(current) ? current.map((row) => row.hash) : []).toEqual(['h-1']);

    // And the point of asking: the same hashes, observed again, produce no rows.
    const unchanged = observationsFrom(
      [{ component: 'Button', instances: 1, structure: 'h-1' as Digest }],
      {
        project: 'shop',
        subject: 'checkout',
        run: 'run-2',
        commit: 'bbbb',
        profile: 'chromium',
        at: '2026-03-02T10:00:00.000Z',
        accepted: true,
      },
      isKept(current) ? current : [],
    );
    expect(unchanged).toEqual([]);
  });

  it('refuses a subject list longer than one request may carry rather than trimming the answer', async () => {
    // The only refusal here that is about size rather than shape, and it is the
    // opposite of every other cap in this service: the answer is not allowed to
    // be short, because a missing previous row is indistinguishable from a hash
    // that was never recorded — so the run appends a change that did not happen.
    const { url } = await serve();
    const response = await fetch(`${url}${CURRENT_PATH}`, {
      method: 'POST',
      headers: { ...authorized, 'content-type': 'application/json' },
      body: JSON.stringify({
        subjects: Array.from({ length: MAX_CURRENT_SUBJECTS + 1 }, (_, index) => `s${index}`),
      }),
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('is not trimmed to fit');
  });

  it('refuses a body larger than the configured ceiling instead of parsing part of it', async () => {
    const backend = createSqliteBackend({ path: ':memory:' });
    backends.push(backend);
    const service = await serveHistory({ backend, token: TOKEN, maxBodyBytes: 64 });
    services.push(service);

    const response = await fetch(`${service.url}${OBSERVATIONS_PATH}`, {
      method: 'POST',
      headers: { ...authorized, 'content-type': 'application/json' },
      body: JSON.stringify({ run: run(), observations: [observation()], tokens: [] }),
    });

    expect(response.status).toBe(413);
    expect((await backend.runsIn({})).rows).toHaveLength(0);
  });

  it('serves the paths the client package declares, not paths of its own', async () => {
    // The version prefix exists so a mismatch 404s loudly. Asserting the literal
    // list here means renaming a route in one package fails in the other.
    const { url } = await serve();
    for (const path of [LAST_CHANGED_PATH, CHURN_PATH, VALUE_JOURNEY_PATH, REACH_PATH]) {
      const response = await fetch(`${url}${path}?component=Button&subject=checkout&token=--x`, {
        headers: authorized,
      });
      expect([path, response.status]).toEqual([path, 200]);
    }
  });
});
