import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core';
import { BASELINE_FIND_PATH } from '@variance-authority/remote';
import type { RunReport } from '@variance-authority/report';
import { createTribunal } from '../worker.js';
import { createDirectoryBucket } from './bucket.js';
import { openDatabase, type TribunalDatabase } from './database.js';
import { serveTribunal, type TribunalService } from './serve.js';

/**
 * A build, over a socket, onto a disk, and back out as a promoted baseline.
 *
 * Every other test in this package drives `Tribunal.fetch` directly against an
 * in-memory double. This one is the whole delivery: `node:http` on a real port,
 * `node:sqlite` on a real file, `node:fs` on a real directory, and the same
 * router. What it proves is that the three adapters compose — which is the one
 * claim no unit test of any of them makes.
 */

const INGEST = 'ingest-token-0123456789';
const REVIEW = 'review-token-0123456789';

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const BYTES = (() => {
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(255);
  return PNG.sync.write(png).toString('base64');
})();

const BUILD = {
  build: 'ci-1',
  commit: 'abc',
  report: {
    runVersion: 1,
    at: '2026-06-01T10:00:00.000Z',
    identity: IDENTITY,
    retention: 'durable',
    observations: [
      { subject: 'story:a', verdict: 'changed', because: 'it moved', changedPixels: 4, regions: [] },
    ],
  } as unknown as RunReport,
  images: {
    'story:a': {
      after: { bytes: BYTES, documentDigest: 'sha256:d', width: 2, height: 2, missingFonts: [] },
    },
  },
};

let directory: string;
let database: TribunalDatabase;
let service: TribunalService;

async function serve(
  overrides: Partial<Parameters<typeof serveTribunal>[0]> = {},
): Promise<TribunalService> {
  database = await openDatabase(join(directory, 'tribunal.db'));

  service = await serveTribunal({
    tribunal: createTribunal({
      db: database,
      bucket: createDirectoryBucket(join(directory, 'objects')),
      project: 'todomvc',
      ingestToken: INGEST,
      reviewToken: REVIEW,
    }),
    host: '127.0.0.1',
    port: 0,
    tokens: { ingest: INGEST, review: REVIEW },
    // The loopback policy `bin.ts` applies: a bearer decides, and a caller
    // without one is the browser on this machine.
    authorize: (request) => {
      const header = request.headers.get('authorization');
      if (header === `Bearer ${INGEST}`) return 'ingest';
      if (header === `Bearer ${REVIEW}`) return 'review';
      return header === null ? 'review' : null;
    },
    ...overrides,
  });
  return service;
}

function call(
  path: string,
  init: { token?: string; method?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token !== undefined) headers['authorization'] = `Bearer ${init.token}`;

  return fetch(`${service.url}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tribunal-serve-'));
});

afterEach(async () => {
  await service?.close();
  database?.close();
  await rm(directory, { recursive: true, force: true });
});

describe('the three adapters compose into one service', () => {
  it('takes a build from CI and hands it back to a reviewer', async () => {
    await serve();

    expect((await call('/review/builds', { token: INGEST, body: BUILD })).status).toBe(201);

    const listed = (await (await call('/review/builds', { token: REVIEW })).json()) as {
      readonly builds: readonly { readonly build: string; readonly pending: number }[];
    };
    expect(listed.builds).toHaveLength(1);
    expect(listed.builds[0]?.build).toBe('ci-1');
    expect(listed.builds[0]?.pending).toBe(1);
  });

  it('promotes the candidate a reviewer approves, and the next run finds it', async () => {
    await serve();
    await call('/review/builds', { token: INGEST, body: BUILD });

    const decided = await call('/review/builds/ci-1/subjects/story:a/decision', {
      token: REVIEW,
      body: { decision: 'approved', by: 'marina' },
    });
    expect(decided.status).toBe(200);

    // The whole point of the service, through a socket: `variance run` with
    // `baselines.kind: "remote"` asks this question and gets the promoted image.
    const found = (await (
      await call(BASELINE_FIND_PATH, {
        token: INGEST,
        body: { key: { subject: 'story:a' }, identity: IDENTITY },
      })
    ).json()) as { readonly found: { readonly raster: { readonly bytes: string } } | null };
    expect(found.found?.raster.bytes).toBe(BYTES);
  });

  it('survives a restart with the record and the images intact', async () => {
    await serve();
    await call('/review/builds', { token: INGEST, body: BUILD });
    await call('/review/builds/ci-1/subjects/story:a/decision', {
      token: REVIEW,
      body: { decision: 'approved', by: 'marina' },
    });

    await service.close();
    database.close();

    // The claim the file and the directory exist to make, and the one an
    // in-memory double can never make.
    await serve();
    const found = (await (
      await call(BASELINE_FIND_PATH, {
        token: INGEST,
        body: { key: { subject: 'story:a' }, identity: IDENTITY },
      })
    ).json()) as { readonly found: { readonly raster: { readonly bytes: string } } | null };
    expect(found.found?.raster.bytes).toBe(BYTES);
  });

  it('serves an image as bytes rather than as JSON', async () => {
    await serve();
    await call('/review/builds', { token: INGEST, body: BUILD });

    const image = await call('/review/builds/ci-1/subjects/story:a/after.png', { token: REVIEW });
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await image.arrayBuffer()).toString('base64')).toBe(BYTES);
  });
});

describe('the surface is a document and one script', () => {
  it('serves the review page at the root, with no token in it', async () => {
    await serve({ reviewer: 'marina' });

    const page = await fetch(service.url);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');

    const html = await page.text();
    expect(html).toContain('id="variance-review"');
    expect(html).toContain('"reviewer":"marina"');
    // The rule the whole `authorize` design exists for. A page carrying the
    // review token is an approve button in everybody's devtools.
    expect(html).not.toContain(REVIEW);
    expect(html).not.toContain(INGEST);
  });

  it('serves the bundle as a module', async () => {
    await serve();

    const asset = await fetch(`${service.url}/ui/review.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  });

  it('serves the same document at every address the surface renders', async () => {
    // The reason deep links were impossible before: the client can push a URL,
    // and a reload of that URL has to come back with the page. A build page that
    // 404s on refresh is a report with a scrollbar, not a service.
    await serve();

    for (const path of [
      '/builds/7',
      '/builds/7?order=name',
      '/builds/7/changes/Button',
      '/builds/7/subjects/route%2Fcart%401280',
      '/builds/7/run',
      '/changelog',
    ]) {
      const page = await fetch(`${service.url}${path}`);
      expect([path, page.status]).toEqual([path, 200]);
      // Absolute, because this document is served seven segments deep. A
      // relative src asks for `/builds/7/changes/ui/review.js`.
      expect(await page.text()).toContain('src="/ui/review.js"');
    }
  });

  it('leaves the API its own paths', async () => {
    // One table decides both, so the disjointness is a property of the table —
    // but a page pattern that grew a segment would take the ingest down, and
    // that failure is worth catching here rather than in somebody's CI.
    await serve();

    for (const path of ['/review/builds', '/review/changelog', '/baseline/find', '/cache/find']) {
      const answered = await fetch(`${service.url}${path}`);
      expect([path, answered.headers.get('content-type')]).toEqual([path, 'application/json; charset=utf-8']);
    }
  });

  it('serves no page at all when the surface is switched off', async () => {
    await serve({ ui: false });

    // Falls through to the router, which does not know the path. A service
    // ingesting for CI with no reviewer on it has no page to authorize.
    expect((await fetch(service.url)).status).toBe(404);
  });
});

describe('what the transport refuses', () => {
  it('answers 401 without reaching the router when authorize says no', async () => {
    await serve({ authorize: () => null });

    const refused = await call('/review/builds', { token: REVIEW });
    expect(refused.status).toBe(401);
    expect(await refused.text()).toMatch(/not authorized for this deployment/);
  });

  it('will not let a caller choose its own capability', async () => {
    // `authorize` grants ingest; the caller sends the review token anyway. The
    // mount replaces the header, so the Worker sees ingest and refuses to decide.
    await serve({ authorize: () => 'ingest' });
    await call('/review/builds', { token: INGEST, body: BUILD });

    const decided = await call('/review/builds/ci-1/subjects/story:a/decision', {
      token: REVIEW,
      body: { decision: 'approved', by: 'nobody' },
    });
    expect(decided.status).toBe(403);
  });
});
