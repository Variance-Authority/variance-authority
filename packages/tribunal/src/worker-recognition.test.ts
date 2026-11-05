import { beforeEach, describe, expect, it } from 'vitest';
import { createTribunalRoutes } from './next.js';
import { declaredPolicy } from './policy.js';
import { createTribunal, type Tribunal } from './worker.js';
import { bearerPolicy, createMemoryR2, createSqliteD1, type MemoryR2, type SqliteD1 } from './testing.js';

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
    policy: bearerPolicy({ ingest: INGEST, review: REVIEW }),
  });
});

function call(path: string, init: { token: string; body: unknown }): Promise<Response> {
  return worker.fetch(
    new Request(`https://variance.example.com${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${init.token}` },
      body: JSON.stringify(init.body),
    }),
  );
}

describe('what a workflow on another ref may write', () => {
  const onBranch = (): Tribunal =>
    createTribunal({ db, bucket, project: 'p', policy: { principal: () => ({ capability: 'ingest', moves: false }) } });
  const post = (path: string, body: unknown) =>
    onBranch().fetch(new Request(`https://t.example${path}`, { method: 'POST', body: JSON.stringify(body) }));

  it.each(['/baseline/put', '/cache/put', '/v1/approvals'])('refuses %s before reading the body', async (path) => {
    const refused = await post(path, {});

    expect(refused.status).toBe(403);
    expect(await refused.text()).toMatch(/GITHUB_ACTIONS_BASELINE_REF/);
  });

  it('still takes the run itself', async () => {
    expect((await post('/v1/observations', {})).status).not.toBe(403);
  });
});

describe('who may read and who may decide', () => {
  const READ_ROUTES = ['/review/builds', '/review/builds/ci-1', '/review/builds/ci-1/subjects/story:a/after.png'];

  function viewing(): Tribunal {
    return createTribunal({
      db,
      bucket,
      project: 'p',
      policy: {
        principal: (request) =>
          request.headers.get('authorization') === `Bearer ${REVIEW}`
            ? { capability: 'review', name: 'marina' }
            : { capability: 'view' },
        signIn: '/auth/github/login',
      },
    });
  }

  it.each(READ_ROUTES)('answers nobody at %s when nobody is recognized', async (path) => {
    expect((await worker.fetch(new Request(`https://t.example${path}`))).status).toBe(401);
  });

  it('lets a viewer read and refuses the viewer a decision', async () => {
    const open = viewing();

    expect((await open.fetch(new Request('https://t.example/review/builds'))).status).toBe(200);
    const refused = await open.fetch(
      new Request('https://t.example/review/builds/ci-1/subjects/story:a/decision', {
        method: 'POST',
        body: JSON.stringify({ decision: 'approved', by: 'somebody' }),
      }),
    );
    expect(refused.status).toBe(403);
  });

  it('refuses a viewer the share', async () => {
    const refused = await viewing().fetch(new Request('https://t.example/share/mainline/main/manifest.json'));

    expect(refused.status).toBe(403);
  });

  it('refuses a decision whose body names somebody else', async () => {
    const refused = await call('/review/builds/ci-1/subjects/story:a/decision', {
      token: REVIEW,
      body: { decision: 'approved', by: 'somebody-else' },
    });

    expect(refused.status).toBe(403);
    expect(await refused.text()).toMatch(/marina/);
  });

  it('introduces the caller and says where to sign in', async () => {
    const me = async (headers: Record<string, string>) =>
      (await viewing().fetch(new Request('https://t.example/auth/me', { headers }))).json();

    expect(await me({})).toEqual({ capability: 'view', signIn: '/auth/github/login' });
    expect(await me({ authorization: `Bearer ${REVIEW}` })).toEqual({
      capability: 'review',
      name: 'marina',
      signIn: '/auth/github/login',
    });
  });
});

describe('a decision forged from another site', () => {
  const DECISION = '/review/builds/ci-1/subjects/story:a/decision';
  const reviewing = (): Tribunal =>
    createTribunal({
      db,
      bucket,
      project: 'p',
      policy: declaredPolicy({ REVIEW_CREDENTIALS: 'loopback', REVIEWER: 'me' }, { loopback: true }),
    });
  // What a plain form sends: no preflight, and a body the route parses all the same.
  const forged = (path: string, headers: Record<string, string>) =>
    new Request(`http://127.0.0.1:8787${path}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', ...headers },
      body: JSON.stringify({ verdict: 'approve' }),
    });

  it('is refused at the route', async () => {
    const response = await reviewing().fetch(forged(DECISION, { origin: 'https://attacker.example' }));

    expect(response.status).toBe(401);
  });

  it('is refused under a mount', async () => {
    const routes = createTribunalRoutes(reviewing(), { basePath: '/api' });

    const response = await routes.POST(forged(`/api${DECISION}`, { 'sec-fetch-site': 'cross-site' }));

    expect(response.status).toBe(401);
  });

  it('reaches the route from the page itself', async () => {
    const response = await reviewing().fetch(forged(DECISION, { 'sec-fetch-site': 'same-origin' }));

    expect(response.status).not.toBe(401);
  });
});
