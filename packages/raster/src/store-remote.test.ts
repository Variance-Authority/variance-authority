import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderDocument, RenderIdentity, Viewport } from '@variance-authority/core';
import { documentDigest } from '@variance-authority/core';
import { observeAgainstBaseline } from './observe.js';
import type { Renderer } from './renderer.js';
import { createDurableStore, type RasterStore } from './store.js';
import {
  createRemoteStore,
  serveRasterStore,
  RasterStoreError,
  type StoreServer,
} from './store-remote.js';

/**
 * A store on the other side of a hop, over a real socket.
 *
 * In-process round trips would test the wrong thing twice over. The claims here
 * are about *serialization* — a baseline has to arrive with its bytes and the
 * identity that wrote it intact — and about *failure*, which a mock cannot
 * produce honestly because a mock is always reachable.
 *
 * Every failure test below is the same test: a store that cannot answer must not
 * be heard as answering "no baseline". `new` re-records what is on screen, so a
 * network blip read as a miss does not skip a check, it destroys the thing the
 * check was against, and reports success while doing it.
 */

const VIEWPORT: Viewport = { width: 100, height: 100, deviceScaleFactor: 1, colorScheme: 'light' };

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

const RUNNER: RenderIdentity = { ...MAC, platform: 'linux/x64' };

function rasterOf(identity: RenderIdentity, bytes = 'QUJD'): Raster {
  return { documentDigest: 'v1:doc', identity, width: 10, height: 20, bytes, missingFonts: ['Inter'] };
}

function documentOf(html: string): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id: 'story:a', kind: 'story' },
    html,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

function countingRenderer(identity: RenderIdentity): Renderer & { calls: number } {
  const renderer = {
    identity,
    calls: 0,
    async render(document: RenderDocument): Promise<Raster> {
      renderer.calls += 1;
      return { ...rasterOf(identity), documentDigest: documentDigest(document) };
    },
    async close(): Promise<void> {},
  };
  return renderer;
}

let root: string;
let server: StoreServer | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-remote-'));
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

/** A URL nothing is listening on, obtained by binding a port and giving it back. */
async function deadEndpoint(): Promise<string> {
  const shortLived = await serveRasterStore(createDurableStore(root));
  const url = shortLived.url;
  await shortLived.close();
  return url;
}

describe('a baseline store somewhere else', () => {
  it('carries a baseline across the wire byte for byte', async () => {
    server = await serveRasterStore(createDurableStore(root));
    const store = createRemoteStore({ endpoint: server.url });

    await store.put({ subject: 'todo--empty' }, rasterOf(MAC, 'SGVsbG8='));
    const found = await store.find({ subject: 'todo--empty' }, MAC);

    expect(found?.comparable).toBe(true);
    expect(found?.raster).toEqual(rasterOf(MAC, 'SGVsbG8='));
  });

  it('carries the identity partition across the hop', async () => {
    // The partition belongs to the backing store, and the hop must neither add to
    // it nor erode it. A client that dropped `comparable` on the floor would
    // compare two machines and blame a component for a driver.
    server = await serveRasterStore(createDurableStore(root));
    const store = createRemoteStore({ endpoint: server.url });

    await store.put({ subject: 'todo--empty' }, rasterOf(RUNNER));
    const found = await store.find({ subject: 'todo--empty' }, MAC);

    expect(found?.comparable).toBe(false);
    expect(found?.storedUnder).toEqual(RUNNER);
  });

  it('round-trips the render cache, so offloading storage does not cost a re-render', async () => {
    server = await serveRasterStore(createDurableStore(root));
    const store = createRemoteStore({ endpoint: server.url });

    await store.cache(rasterOf(MAC, 'QQ=='));

    expect((await store.cached('v1:doc', MAC))?.bytes).toBe('QQ==');
    expect(await store.cached('v1:other', MAC)).toBeNull();
  });

  it('reports a subject nobody has rendered as a miss, and only then', async () => {
    // The one case allowed to be `null`: a server that positively said so.
    server = await serveRasterStore(createDurableStore(root));
    const store = createRemoteStore({ endpoint: server.url });

    expect(await store.find({ subject: 'never-seen' }, MAC)).toBeNull();
  });

  it('accepts a bearer token the operator set', async () => {
    server = await serveRasterStore(createDurableStore(root), { token: 'sekrit' });
    const store = createRemoteStore({ endpoint: server.url, token: 'sekrit' });

    await store.put({ subject: 's' }, rasterOf(MAC));
    expect((await store.find({ subject: 's' }, MAC))?.comparable).toBe(true);
  });
});

describe('a store that cannot answer', () => {
  it('reports an unreachable endpoint as an error rather than as a missing baseline', async () => {
    const store = createRemoteStore({ endpoint: await deadEndpoint() });

    await expect(store.find({ subject: 's' }, MAC)).rejects.toBeInstanceOf(RasterStoreError);
    await expect(store.find({ subject: 's' }, MAC)).rejects.toThrow(/unreachable/);
  });

  it('reports a refused token as an error rather than as a missing baseline', async () => {
    // A 401 is the most plausible misconfiguration of all, and the one whose
    // "answer" — nothing — reads exactly like an empty store.
    server = await serveRasterStore(createDurableStore(root), { token: 'sekrit' });
    const store = createRemoteStore({ endpoint: server.url });

    await expect(store.find({ subject: 's' }, MAC)).rejects.toThrow(/returned 401/);
  });

  it('reports a failing backing store as an error rather than as a missing baseline', async () => {
    const broken: RasterStore = {
      retention: 'durable',
      find: () => Promise.reject(new Error('disk went away')),
      put: () => Promise.resolve(),
      cached: () => Promise.resolve(null),
      cache: () => Promise.resolve(),
    };
    server = await serveRasterStore(broken);
    const store = createRemoteStore({ endpoint: server.url });

    await expect(store.find({ subject: 's' }, MAC)).rejects.toThrow(/disk went away/);
  });

  it('refuses a 200 whose body is not an answer', async () => {
    // Protocol drift, an error page that happens to parse, a proxy with opinions.
    // None of them said "no baseline", and reading them as if they had is the one
    // mistake this client is not allowed to make.
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () => new Response('{"nothing":true}', { status: 200 }),
    });

    await expect(store.find({ subject: 's' }, MAC)).rejects.toThrow(/no `found` field/);
  });

  it('refuses a bare `null` body, which is the shape a miss would take if it were sloppy', async () => {
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () => new Response('null', { status: 200 }),
    });

    await expect(store.find({ subject: 's' }, MAC)).rejects.toThrow(RasterStoreError);
  });

  it('refuses a baseline whose comparability it was not told', async () => {
    // Neither default is available. `true` compares two machines; `false` reports
    // every subject incomparable. Both are verdicts invented by a parser.
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () =>
        new Response(
          JSON.stringify({ found: { raster: rasterOf(MAC), storedUnder: MAC } }),
          { status: 200 },
        ),
    });

    await expect(store.find({ subject: 's' }, MAC)).rejects.toThrow(/comparable/);
  });

  it('refuses a cache answer it cannot read, rather than paying for a re-render', async () => {
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () => new Response('{"raster":{"bytes":42}}', { status: 200 }),
    });

    await expect(store.cached('v1:doc', MAC)).rejects.toThrow(/not a raster/);
  });

  it('fails a lookup that hangs rather than stalling the run', async () => {
    // A store that never answers is indistinguishable from one that is thinking,
    // and a run that waits forever is a CI job someone cancels and re-runs.
    server = await serveRasterStore({
      retention: 'durable',
      find: () => new Promise(() => {}),
      put: () => Promise.resolve(),
      cached: () => Promise.resolve(null),
      cache: () => Promise.resolve(),
    });
    const store = createRemoteStore({ endpoint: server.url, timeoutMs: 50 });

    await expect(store.find({ subject: 's' }, MAC)).rejects.toBeInstanceOf(RasterStoreError);
  });

  it('does not record a new baseline when the store cannot be reached', async () => {
    // Acceptance 3, end to end: the run fails, the renderer is never asked, and
    // nothing is written — because the alternative is overwriting a baseline with
    // whatever the current build happens to paint.
    const renderer = countingRenderer(MAC);
    const store = createRemoteStore({ endpoint: await deadEndpoint() });

    await expect(
      observeAgainstBaseline(documentOf('<div data-va-path="0">x</div>'), { subject: 's' }, {
        renderer,
        store,
      }),
    ).rejects.toBeInstanceOf(RasterStoreError);

    expect(renderer.calls).toBe(0);
    expect(await readdir(root)).toEqual([]);
  });
});
