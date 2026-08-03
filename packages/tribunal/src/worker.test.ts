import { PNG } from 'pngjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { documentDigest, type RenderDocument, type RenderIdentity } from '@variance-authority/core';
import {
  BASELINE_DESCRIBE_PATH,
  BASELINE_FIND_PATH,
  BASELINE_PUT_PATH,
  CACHE_FIND_PATH,
  CACHE_PUT_PATH,
} from '@variance-authority/remote';
import type { RunReport } from '@variance-authority/report';
import { createTribunal, type Tribunal } from './worker.js';
import { createMemoryR2, createSqliteD1, type MemoryR2, type SqliteD1 } from './testing.js';

const INGEST = 'ingest-token-0123456789';
const REVIEW = 'review-token-0123456789';

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const DOCUMENT: RenderDocument = {
  documentVersion: 1,
  subject: { id: 'story:a', kind: 'story' },
  html: '<i>a</i>',
  frame: { html: {}, body: {}, ancestors: [] },
  css: [],
  viewport: { width: 2, height: 2, deviceScaleFactor: 1, colorScheme: 'light' },
  inherited: {},
  fonts: [],
  diagnostics: [],
};

const BYTES = (() => {
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(255);
  return PNG.sync.write(png).toString('base64');
})();

const RASTER = {
  documentDigest: documentDigest(DOCUMENT),
  identity: IDENTITY,
  width: 2,
  height: 2,
  bytes: BYTES,
  missingFonts: [],
};

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

describe('the wire is the one the clients already speak', () => {
  it('serves the paths `@variance-authority/remote` addresses', () => {
    // The whole claim of this package: `variance run` with
    // `baselines.kind: "remote"` reaches it with no change to the CLI. That is
    // only true while these five strings match, and they are restated in
    // `worker.ts` rather than imported — so this is the gate that stops the
    // restatement drifting into a 404 nobody can explain.
    expect([
      BASELINE_FIND_PATH,
      BASELINE_DESCRIBE_PATH,
      BASELINE_PUT_PATH,
      CACHE_FIND_PATH,
      CACHE_PUT_PATH,
    ]).toEqual(['/baseline/find', '/baseline/describe', '/baseline/put', '/cache/find', '/cache/put']);
  });

  it('round-trips a baseline through put, describe and find', async () => {
    expect(
      (await call(BASELINE_PUT_PATH, { token: INGEST, body: { key: { subject: 's' }, raster: RASTER } }))
        .status,
    ).toBe(200);

    const described = await (
      await call(BASELINE_DESCRIBE_PATH, {
        token: INGEST,
        body: { key: { subject: 's' }, identity: IDENTITY },
      })
    ).json();
    expect(described).toEqual({
      described: { documentDigest: RASTER.documentDigest, comparable: true, storedUnder: IDENTITY },
    });

    const found = (await (
      await call(BASELINE_FIND_PATH, {
        token: INGEST,
        body: { key: { subject: 's' }, identity: IDENTITY },
      })
    ).json()) as { found: { raster: { bytes: string } } };
    expect(found.found.raster.bytes).toBe(BYTES);
  });

  it('answers a subject nobody has stored with an explicit null', async () => {
    // `null` and only `null`. The client turns anything else into a thrown error
    // precisely because a shrug here becomes `new`, and `new` re-records.
    const body = await (
      await call(BASELINE_FIND_PATH, {
        token: INGEST,
        body: { key: { subject: 'never-seen' }, identity: IDENTITY },
      })
    ).json();

    expect(body).toEqual({ found: null });
  });

  it('round-trips the render cache', async () => {
    await call(CACHE_PUT_PATH, { token: INGEST, body: { raster: RASTER } });

    const body = (await (
      await call(CACHE_FIND_PATH, {
        token: INGEST,
        body: { digest: RASTER.documentDigest, identity: IDENTITY },
      })
    ).json()) as { raster: { bytes: string } | null };

    expect(body.raster?.bytes).toBe(BYTES);
  });

  it('refuses an identity it cannot rebuild field by field', async () => {
    const response = await call(BASELINE_FIND_PATH, {
      token: INGEST,
      body: { key: { subject: 's' }, identity: { renderer: 'only-this' } },
    });

    // Never defaulted. An identity missing a field is a different machine, and
    // inventing the field makes a wrong-machine comparison look comparable.
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/not a renderer identity/);
  });

  it('records and answers a history question', async () => {
    const recorded = await call('/v1/observations', {
      token: INGEST,
      body: {
        run: {
          project: 'todomvc',
          run: 'r-1',
          commit: 'c-1',
          profile: 'chromium',
          at: '2026-06-01T00:00:00.000Z',
        },
        observations: [
          {
            project: 'todomvc',
            subject: 'story:card',
            component: 'Button',
            band: 'style',
            hash: 'aaaa',
            profile: 'chromium',
            commit: 'c-1',
            run: 'r-1',
            at: '2026-06-01T00:00:00.000Z',
            accepted: true,
          },
        ],
        tokens: [],
      },
    });
    expect(recorded.status).toBe(204);

    const churn = await (
      await call('/v1/churn?project=todomvc&component=Button', { token: INGEST })
    ).json();
    expect(churn).toMatchObject({ component: 'Button', runs: 1 });
  });

  it('refuses a row that would be unanswerable once appended', async () => {
    // The store is append-only, so this is the last moment anything can be
    // refused. A row with an unknown band that gets in stays in.
    const response = await call('/v1/observations', {
      token: INGEST,
      body: {
        run: {
          project: 'todomvc',
          run: 'r-2',
          commit: 'c-2',
          profile: 'chromium',
          at: '2026-06-01T00:00:00.000Z',
        },
        observations: [
          {
            project: 'todomvc',
            subject: 'story:card',
            component: 'Button',
            band: 'colour',
            hash: 'aaaa',
            profile: 'chromium',
            commit: 'c-2',
            run: 'r-2',
            at: '2026-06-01T00:00:00.000Z',
            accepted: true,
          },
        ],
        tokens: [],
      },
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/structure, style, geometry/);
  });

  it('refuses a window bound that would quietly select nothing', async () => {
    const response = await call('/v1/churn?component=Button&since=last%20tuesday', {
      token: INGEST,
    });

    expect(response.status).toBe(400);
  });
});

describe('two tokens, and what each one may do', () => {
  const build = {
    build: 'ci-1',
    commit: 'abc',
    report: {
      runVersion: 1,
      at: '2026-06-01T10:00:00.000Z',
      identity: IDENTITY,
      retention: 'durable',
      observations: [
        {
          subject: 'story:a',
          verdict: 'changed',
          because: 'it moved',
          changedPixels: 4,
          regions: [],
        },
      ],
    } as unknown as RunReport,
    images: {
      'story:a': {
        after: {
          bytes: BYTES,
          documentDigest: RASTER.documentDigest,
          width: 2,
          height: 2,
          missingFonts: [],
        },
      },
    },
  };

  it('lets CI post a build and refuses to let it decide', async () => {
    expect((await call('/review/builds', { token: INGEST, body: build })).status).toBe(201);

    const decided = await call('/review/builds/ci-1/subjects/story:a/decision', {
      token: INGEST,
      body: { decision: 'approved', by: 'ci' },
    });

    // Approving promotes a baseline. Anything that can read a build log must not
    // be able to do it.
    expect(decided.status).toBe(403);
    expect(await decided.text()).toMatch(/not something a build log can do/);
  });

  it('lets a reviewer decide and refuses to let them post a build', async () => {
    await call('/review/builds', { token: INGEST, body: build });

    const decided = await call('/review/builds/ci-1/subjects/story:a/decision', {
      token: REVIEW,
      body: { decision: 'approved', by: 'marina' },
    });
    expect(decided.status).toBe(200);

    // And the promotion is real: the next run's lookup answers differently.
    const found = (await (
      await call(BASELINE_FIND_PATH, {
        token: INGEST,
        body: { key: { subject: 'story:a' }, identity: IDENTITY },
      })
    ).json()) as { found: { raster: { bytes: string } } | null };
    expect(found.found?.raster.bytes).toBe(BYTES);

    expect((await call('/review/builds', { token: REVIEW, body: build })).status).toBe(403);
  });

  it('serves an image only to the review token', async () => {
    await call('/review/builds', { token: INGEST, body: build });

    const image = await call('/review/builds/ci-1/subjects/story:a/after.png', { token: REVIEW });
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');

    expect(
      (await call('/review/builds/ci-1/subjects/story:a/after.png', { token: INGEST })).status,
    ).toBe(403);
  });

  it('reports a decision it cannot carry out as the caller’s problem, not the platform’s', async () => {
    await call('/review/builds', {
      token: INGEST,
      body: { ...build, build: 'ci-2', images: {} },
    });

    const response = await call('/review/builds/ci-2/subjects/story:a/decision', {
      token: REVIEW,
      body: { decision: 'approved', by: 'marina' },
    });

    // 422, not 500. A dashboard that showed "Cloudflare is down" for a reviewer
    // who approved a subject with no candidate sends somebody to the wrong page.
    expect(response.status).toBe(422);
    expect(await response.text()).toMatch(/did not upload a candidate/);
  });
});

describe('authentication happens before routing', () => {
  it('answers a real path and an invented one identically without a token', async () => {
    const real = await call(BASELINE_FIND_PATH, { method: 'POST', body: {} });
    const invented = await call('/does/not/exist');

    expect(real.status).toBe(401);
    expect(invented.status).toBe(401);
    expect(await real.text()).toBe(await invented.text());
    expect(real.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('answers the same for a wrong token as for none', async () => {
    const wrong = await call('/review/builds', { token: 'not-the-token-at-all' });
    const none = await call('/review/builds');

    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toBe(await none.text());
  });

  it('refuses to start with a token short enough to guess', () => {
    expect(() =>
      createTribunal({ db, bucket, project: 'p', ingestToken: 'short', reviewToken: REVIEW }),
    ).toThrow(/shorter than 16/);
  });

  it('refuses to start when both tokens are one secret', () => {
    expect(() =>
      createTribunal({ db, bucket, project: 'p', ingestToken: INGEST, reviewToken: INGEST }),
    ).toThrow(/one secret and not two/);
  });
});

describe('what the review surface answers', () => {
  it('lists builds and names the route it does not serve', async () => {
    expect(await (await call('/review/builds', { token: REVIEW })).json()).toEqual({ builds: [] });

    const missing = await call('/review/builds/never-ran', { token: REVIEW });
    expect(missing.status).toBe(404);
  });

  it('answers a wrong method with 405 and says which one it wants', async () => {
    const response = await call('/review/sweep', { token: REVIEW });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('reports what a sweep removed', async () => {
    const swept = await (await call('/review/sweep?days=0', { token: REVIEW, body: {} })).json();

    expect(swept).toEqual({ builds: 0, subjects: 0, objects: 0, decisions: 0 });
  });
});
