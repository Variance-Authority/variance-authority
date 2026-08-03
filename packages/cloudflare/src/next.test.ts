import { beforeEach, describe, expect, it } from 'vitest';
import { createVarianceRoutes } from './next.js';
import type { VarianceWorker } from './worker.js';

/**
 * The adapter is four lines of behaviour, and every one of them can fail
 * silently, so every one of them is pinned.
 */

const INGEST = 'ingest-token-0123456789';
const REVIEW = 'review-token-0123456789';

let seen: { url: string; authorization: string | null; method: string }[];
let worker: VarianceWorker;

beforeEach(() => {
  seen = [];
  worker = {
    async fetch(request: Request): Promise<Response> {
      seen.push({
        url: request.url,
        authorization: request.headers.get('authorization'),
        method: request.method,
      });
      return new Response('{}', { status: 200 });
    },
  };
});

function routes(authorize: (request: Request) => 'ingest' | 'review' | null, basePath = '/variance') {
  return createVarianceRoutes(worker, {
    basePath,
    authorize,
    tokens: { ingest: INGEST, review: REVIEW },
  });
}

describe('mounting inside somebody else’s app', () => {
  it('strips the mount prefix before the Worker sees the path', async () => {
    // Without this every request arrives as `/variance/review/builds` and 404s
    // against a route table that has never heard of the prefix.
    await routes(() => 'review').GET(
      new Request('https://app.example.com/variance/review/builds'),
    );

    expect(new URL(seen[0]?.url ?? '').pathname).toBe('/review/builds');
  });

  it('leaves the path alone when nothing is mounted in front of it', async () => {
    await routes(() => 'review', '').GET(new Request('https://app.example.com/review/builds'));

    expect(new URL(seen[0]?.url ?? '').pathname).toBe('/review/builds');
  });
});

describe('the token stays on the server', () => {
  it('attaches the token the operator’s own gate decided', async () => {
    await routes(() => 'review').GET(new Request('https://app.example.com/variance/review/builds'));

    expect(seen[0]?.authorization).toBe(`Bearer ${REVIEW}`);
  });

  it('replaces a bearer the caller sent rather than honouring it', async () => {
    // Otherwise a browser could name its own capability and `authorize` would be
    // advisory — which is to say, not a gate.
    await routes(() => 'review').POST(
      new Request('https://app.example.com/variance/review/builds', {
        method: 'POST',
        headers: { authorization: `Bearer ${INGEST}` },
        body: '{}',
      }),
    );

    expect(seen[0]?.authorization).toBe(`Bearer ${REVIEW}`);
  });

  it('answers 401 without reaching the Worker when the gate refuses', async () => {
    const response = await routes(() => null).GET(
      new Request('https://app.example.com/variance/review/builds'),
    );

    expect(response.status).toBe(401);
    expect(seen).toEqual([]);
  });
});
