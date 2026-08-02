import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core';
import { RasterStoreError, type RasterStore } from '@variance-authority/raster';
import { createDurableStore } from '@variance-authority/store';
import {
  BASELINE_DESCRIBE_PATH,
  createRemoteStore,
  serveRasterStore,
  type StoreServer,
} from './store.js';

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

  it('describes a baseline without sending the image over the wire', async () => {
    // The hop is where an unnecessary image costs the most: serialized, sent,
    // parsed, held. The response is read as text and searched for the bytes,
    // because "the client did not expose them" and "the server did not send
    // them" are different claims and only the second one saves anything.
    server = await serveRasterStore(createDurableStore(root));
    const store = createRemoteStore({ endpoint: server.url });
    await store.put({ subject: 'todo--empty' }, rasterOf(MAC, 'SGVsbG8='));

    const described = await store.describe({ subject: 'todo--empty' }, MAC);
    const body = await (
      await fetch(`${server.url}${BASELINE_DESCRIBE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: { subject: 'todo--empty' }, identity: MAC }),
      })
    ).text();

    expect(described).toEqual({
      documentDigest: 'v1:doc',
      comparable: true,
      storedUnder: MAC,
    });
    expect(body).not.toContain('SGVsbG8=');
  });

  it('carries the identity partition on the cheap lookup too', async () => {
    // A description that dropped `comparable` would settle a wrong-machine run to
    // `new`, and `new` re-records — the partition has to survive the hop on both
    // routes or it only holds on the one somebody remembered to test.
    server = await serveRasterStore(createDurableStore(root));
    const store = createRemoteStore({ endpoint: server.url });

    await store.put({ subject: 's' }, rasterOf(RUNNER));
    const described = await store.describe({ subject: 's' }, MAC);

    expect(described?.comparable).toBe(false);
    expect(described?.storedUnder).toEqual(RUNNER);
  });

  it('reports a described subject nobody has rendered as a miss, and only then', async () => {
    server = await serveRasterStore(createDurableStore(root));
    const store = createRemoteStore({ endpoint: server.url });

    expect(await store.describe({ subject: 'never-seen' }, MAC)).toBeNull();
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
      describe: () => Promise.reject(new Error('disk went away')),
      put: () => Promise.resolve(),
      cached: () => Promise.resolve(null),
      cache: () => Promise.resolve(),
    };
    server = await serveRasterStore(broken);
    const store = createRemoteStore({ endpoint: server.url });

    await expect(store.find({ subject: 's' }, MAC)).rejects.toThrow(/disk went away/);
    await expect(store.describe({ subject: 's' }, MAC)).rejects.toThrow(/disk went away/);
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

  it('refuses a description body that is not an answer', async () => {
    // The cheap route is the one a caller reaches for on every subject, so a body
    // it is willing to guess at is a body that settles a whole run.
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () => new Response('{"nothing":true}', { status: 200 }),
    });

    await expect(store.describe({ subject: 's' }, MAC)).rejects.toThrow(/no `described` field/);
  });

  it('refuses a description with no document digest rather than rendering everything', async () => {
    // The quiet one. Absent, the digest compares as `undefined` against a real one
    // and never matches, so every subject renders: a broken server hidden behind a
    // bill for images and a run that still reports verdicts.
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () =>
        new Response(JSON.stringify({ described: { comparable: true, storedUnder: MAC } }), {
          status: 200,
        }),
    });

    await expect(store.describe({ subject: 's' }, MAC)).rejects.toThrow(/documentDigest/);
  });

  it('refuses a description whose comparability it was not told', async () => {
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () =>
        new Response(
          JSON.stringify({ described: { documentDigest: 'v1:doc', storedUnder: MAC } }),
          { status: 200 },
        ),
    });

    await expect(store.describe({ subject: 's' }, MAC)).rejects.toThrow(/comparable/);
  });

  it('fails a lookup that hangs rather than stalling the run', async () => {
    // A store that never answers is indistinguishable from one that is thinking,
    // and a run that waits forever is a CI job someone cancels and re-runs.
    server = await serveRasterStore({
      retention: 'durable',
      find: () => new Promise(() => {}),
      describe: () => new Promise(() => {}),
      put: () => Promise.resolve(),
      cached: () => Promise.resolve(null),
      cache: () => Promise.resolve(),
    });
    const store = createRemoteStore({ endpoint: server.url, timeoutMs: 50 });

    await expect(store.find({ subject: 's' }, MAC)).rejects.toBeInstanceOf(RasterStoreError);
  });
});
