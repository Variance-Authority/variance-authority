/**
 * A worker whose run names heads: each test's journey is minted before the test
 * runs and carried to the application on the browser context, with the address
 * a head reports back to.
 */

import type { Page } from '@playwright/test';
import { JOURNEY_COOKIE, RETURN_COOKIE } from '@variance-authority/wire';
import { describe, expect, it } from 'vitest';
import { createExecutionRecorder } from './execution.js';

describe('a worker whose run names heads', () => {
  it('puts one journey and its way home on the context, scoped to the origin', async () => {
    const recorder = createExecutionRecorder({ heads: ['api'] });
    const set: { name: string; value: string; url?: string }[] = [];
    const page = {
      context: () => ({ addCookies: async (cookies: typeof set) => void set.push(...cookies) }),
    } as unknown as Page;
    try {
      const journey = await recorder.join(page, 'checkout.spec.ts', 'http://localhost:3000');

      expect(set.map(({ name, url }) => [name, url])).toEqual([
        [JOURNEY_COOKIE, 'http://localhost:3000'],
        [RETURN_COOKIE, 'http://localhost:3000'],
      ]);
      expect(set[0]!.value).toBe(journey);
      expect(set[1]!.value).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    } finally {
      await recorder.close();
    }
  });
});
