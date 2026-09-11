import { afterEach, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import {
  CHURN_PATH,
  OBSERVATIONS_PATH,
  VALUE_JOURNEY_PATH,
  type Observation,
  type RunRecord,
} from '@variance-authority/history';
import { createSqliteBackend } from './backend-sqlite.js';
import { lastChangedFrom } from './answers.js';
import type { HistoryBackend } from './backend.js';
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


const authorized = { authorization: `Bearer ${TOKEN}` };

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
