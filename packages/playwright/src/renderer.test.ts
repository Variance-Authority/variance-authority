import { describe, expect, it, vi } from 'vitest';

const release = vi.fn(async () => {});

// Cut at the lease and the pool: the renderer's own close is what is under test.
vi.mock('./browsers.js', () => ({
  leaseBrowser: async () => ({ value: { version: () => '0' }, release }),
}));
vi.mock('./page-pool.js', () => ({
  PagePool: class {
    async close(): Promise<void> {
      throw new Error('a context failed to close');
    }
  },
}));

const { createPlaywrightRenderer } = await import('./renderer.js');

describe('closing a renderer whose pages fail to close', () => {
  it('still gives its hold on the browser back', async () => {
    const renderer = await createPlaywrightRenderer({});

    await expect(renderer.close()).rejects.toThrow('a context failed to close');
    expect(release).toHaveBeenCalledOnce();
  });
});
