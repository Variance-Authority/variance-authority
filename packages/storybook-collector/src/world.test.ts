import { afterEach, describe, expect, it, vi } from 'vitest';

const harnessClose = vi.fn(async () => {});

// Cut at the harness: the world's own close is what is under test.
vi.mock('@variance-authority/playwright', () => ({
  createObservedHarness: async () => ({
    harness: { page: { on: () => {} }, engine: 'chromium', region: {}, driven: [], close: harnessClose },
    network: {
      close: async () => {
        throw new Error('the observation failed to close');
      },
    },
  }),
}));

const { openWorld } = await import('./world.js');

afterEach(() => harnessClose.mockClear());

describe('closing a world whose observation fails to close', () => {
  it('still closes the harness, and gives its hold on the browser back', async () => {
    const world = await openWorld({ harness: {}, network: {} } as unknown as Parameters<typeof openWorld>[0]);

    await expect(world.close()).rejects.toThrow('the observation failed to close');
    expect(harnessClose).toHaveBeenCalledOnce();
  });
});
