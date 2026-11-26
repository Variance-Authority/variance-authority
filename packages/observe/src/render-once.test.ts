import { describe, expect, it } from 'vitest';
import type { RenderDocument } from '@variance-authority/core/format';
import type { RasterStore, Renderer } from '@variance-authority/raster';
import { renderOnce } from './render-once.js';

/** A document is a canvas or it is not; nothing else here matters to the cache. */
function documentOf(html: string): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id: 'fixture:a', kind: 'fixture' },
    html,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: { width: 10, height: 10, deviceScaleFactor: 1, colorScheme: 'light' },
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

function rig() {
  const calls = { get: 0, put: 0, render: 0 };
  const cached = { png: 'cached' };
  const painted = { png: 'painted' };
  const store = {
    renderCache: {
      get: async () => {
        calls.get += 1;
        return cached;
      },
      put: async () => {
        calls.put += 1;
      },
    },
  } as unknown as RasterStore;
  const renderer = {
    identityFor: () => ({}),
    render: async () => {
      calls.render += 1;
      return painted;
    },
  } as unknown as Renderer;
  return { calls, store, renderer };
}

describe('renderOnce', () => {
  it('answers a plain document from the cache', async () => {
    const { calls, store, renderer } = rig();
    const { rendered } = await renderOnce(renderer, store, documentOf('<div>x</div>'));
    expect(rendered).toBe(false);
    expect(calls).toEqual({ get: 1, put: 0, render: 0 });
  });

  it('refuses a document holding a canvas, touching neither the cache nor the renderer', async () => {
    const { calls, store, renderer } = rig();
    await expect(renderOnce(renderer, store, documentOf('<div><canvas></canvas></div>'))).rejects.toThrow(/canvas.*in-place/s);
    expect(calls).toEqual({ get: 0, put: 0, render: 0 });
  });
});
