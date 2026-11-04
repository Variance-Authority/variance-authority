import { beforeEach, describe, expect, it } from 'vitest';
import { createTribunalRoutes } from './next.js';
import type { Tribunal } from './worker.js';

/**
 * The adapter moves a path and nothing else. Who is calling is the Worker's
 * question, so the request reaches it as it arrived: a header dropped here is a
 * person the policy cannot recognize.
 */

let seen: { url: string; authorization: string | null; method: string }[];
let worker: Tribunal;

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

describe('mounting inside somebody else’s app', () => {
  it('strips the mount prefix before the Worker sees the path', async () => {
    // Without this every request arrives as `/variance/review/builds` and 404s
    // against a route table that has never heard of the prefix.
    await createTribunalRoutes(worker, { basePath: '/variance' }).GET(
      new Request('https://app.example.com/variance/review/builds'),
    );

    expect(new URL(seen[0]?.url ?? '').pathname).toBe('/review/builds');
  });

  it('leaves the path alone when nothing is mounted in front of it', async () => {
    await createTribunalRoutes(worker).GET(new Request('https://app.example.com/review/builds'));

    expect(new URL(seen[0]?.url ?? '').pathname).toBe('/review/builds');
  });

  it('hands the Worker the caller’s credential untouched', async () => {
    await createTribunalRoutes(worker, { basePath: '/variance' }).PUT(
      new Request('https://app.example.com/variance/share/mainline/main/manifest.json', {
        method: 'PUT',
        headers: { authorization: 'Bearer whatever-the-caller-sent' },
        body: '{}',
      }),
    );

    expect(seen[0]).toMatchObject({ method: 'PUT', authorization: 'Bearer whatever-the-caller-sent' });
    expect(new URL(seen[0]?.url ?? '').pathname).toBe('/share/mainline/main/manifest.json');
  });
});
