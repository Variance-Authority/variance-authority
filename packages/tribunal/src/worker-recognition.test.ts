import { beforeEach, describe, expect, it } from 'vitest';
import { createTribunalRoutes } from './next.js';
import { declaredPolicy } from './policy.js';
import { createTribunal, type Policy, type Tribunal } from './worker.js';
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

describe('a write forged from another site', () => {
  const DECISION = '/review/builds/ci-1/subjects/story:a/decision';
  const ORIGIN = 'http://127.0.0.1:8787';
  // A host's own session, which knows nothing of where a write came from.
  const session: Policy = {
    principal: (request) =>
      request.headers.get('cookie') === 'session=me' || request.headers.get('authorization') === 'Bearer mine'
        ? { capability: 'review', name: 'me' }
        : null,
  };
  const POLICIES: readonly (readonly [string, Policy])[] = [
    ["a host's own session", session],
    ['the declared policy', declaredPolicy({ REVIEW_CREDENTIALS: 'loopback', REVIEWER: 'me' }, { loopback: true })],
  ];
  const serving = (policy: Policy): Tribunal => createTribunal({ db, bucket, project: 'p', policy });
  // What a plain form sends: no preflight, and a body the route parses all the same.
  const forged = (path: string, headers: Record<string, string>, method = 'POST') =>
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { 'content-type': 'text/plain', cookie: 'session=me', ...headers },
      ...(method === 'POST' ? { body: JSON.stringify({ verdict: 'approve' }) } : {}),
    });

  describe.each(POLICIES)('under %s', (_, policy) => {
    it.each([
      ['a form on another site', { 'sec-fetch-site': 'cross-site' }],
      ['a sibling subdomain', { 'sec-fetch-site': 'same-site' }],
      ['a browser that names only its origin', { origin: 'https://attacker.example' }],
      ['a sandboxed frame', { origin: 'null' }],
      ['the same host over another scheme', { origin: 'https://127.0.0.1:8787' }],
    ])('is refused from %s', async (_name, headers) => {
      expect((await serving(policy).fetch(forged(DECISION, headers))).status).toBe(401);
    });

    it('is refused under a mount', async () => {
      const routes = createTribunalRoutes(serving(policy), { basePath: '/api' });

      expect((await routes.POST(forged(`/api${DECISION}`, { 'sec-fetch-site': 'cross-site' }))).status).toBe(401);
    });

    it.each([
      ['the page itself', { 'sec-fetch-site': 'same-origin', origin: ORIGIN }],
      ['a browser that names only its origin', { origin: ORIGIN }],
      ['a caller that is no browser', {}],
    ])('reaches the route from %s', async (_name, headers) => {
      expect((await serving(policy).fetch(forged(DECISION, headers))).status).not.toBe(401);
    });

    it('reaches the route from the page under a mount', async () => {
      const routes = createTribunalRoutes(serving(policy), { basePath: '/api' });

      expect((await routes.POST(forged(`/api${DECISION}`, { 'sec-fetch-site': 'same-origin' }))).status).not.toBe(401);
    });

    it('leaves a read from another site alone', async () => {
      const read = forged('/review/builds', { 'sec-fetch-site': 'cross-site' }, 'GET');

      expect((await serving(policy).fetch(read)).status).not.toBe(401);
    });
  });

  it('is refused from a name rebound to this machine, which the browser calls its own origin', async () => {
    const request = new Request(`http://attacker.example:8787${DECISION}`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', origin: 'http://attacker.example:8787' },
      body: '{}',
    });

    expect((await serving(POLICIES[1]![1]).fetch(request)).status).toBe(401);
  });

  it('does not ask a policy about it at all', async () => {
    const asked: Request[] = [];
    const watching: Policy = {
      principal: (request) => {
        asked.push(request);
        return null;
      },
      serve: (request) => {
        asked.push(request);
        return Promise.resolve(null);
      },
    };

    await serving(watching).fetch(forged(DECISION, { 'sec-fetch-site': 'cross-site' }));

    expect(asked).toEqual([]);
  });

  it('still hands a policy its own routes on a read, which a sign-in needs', async () => {
    const signingIn: Policy = {
      principal: () => null,
      serve: () => Promise.resolve(new Response('signed in')),
    };
    const arrival = new Request(`${ORIGIN}/auth/callback`, { headers: { 'sec-fetch-site': 'cross-site' } });

    expect(await (await serving(signingIn).fetch(arrival)).text()).toBe('signed in');
  });

  it('takes a bearer from another origin, which no form can send', async () => {
    const request = forged(DECISION, { 'sec-fetch-site': 'cross-site', authorization: 'Bearer mine', cookie: '' });

    expect((await serving(session).fetch(request)).status).not.toBe(401);
  });
});
