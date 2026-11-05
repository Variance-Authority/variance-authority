import { describe, expect, it } from 'vitest';

import { createReviewClient } from './client.js';

describe('who is asking', () => {
  it('asks the service, so the page and the routes cannot disagree', async () => {
    const asked: string[] = [];
    const client = createReviewClient({
      endpoint: '/api',
      fetch: (input) => {
        asked.push(String(input));
        return Promise.resolve(Response.json({ capability: 'review', name: 'octocat' }));
      },
    });

    await expect(client.me()).resolves.toEqual({ capability: 'review', name: 'octocat' });
    expect(asked).toEqual(['/api/auth/me']);
  });

  it('throws at a failure rather than reading it as nobody', async () => {
    const client = createReviewClient({
      endpoint: '',
      fetch: () => Promise.resolve(new Response('no', { status: 500 })),
    });

    await expect(client.me()).rejects.toThrow();
  });
});
