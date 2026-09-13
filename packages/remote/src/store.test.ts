import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { RasterStoreError, type RasterStore } from '@variance-authority/raster';
import { createDurableStore } from '@variance-authority/store/durable';
import {
  BASELINE_DESCRIBE_PATH,
  BASELINE_WORKING_SET_PATH,
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

    await store.renderCache.put(rasterOf(MAC, 'QQ=='));

    expect((await store.renderCache.get('v1:doc', MAC))?.bytes).toBe('QQ==');
    expect(await store.renderCache.get('v1:other', MAC)).toBeNull();
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
      pictured: true,
      // Non-empty on purpose, and the only fixture in the suite that is. This
      // field decides whether a settled subject reports a bare `unchanged` or
      // says the baseline is an image of a substituted font, so a wire that
      // dropped it would be caught here and nowhere else.
      missingFonts: ['Inter'],
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

  it('answers a cache body it cannot read as a miss, where a baseline body refuses', async () => {
    // **Reversed on 2026-08-04.** This asserted that an unreadable cache answer
    // throws, on the reasoning that answering "miss" to an outage turns a broken
    // endpoint into a run that is merely slow. It does, and that is right: the
    // endpoint being down changes nothing about what any verdict should be. A
    // baseline is the opposite — an outage there would produce `new`, and `new`
    // records over the only copy of what the subject looked like.
    //
    // Same server, same nonsense, two answers.
    const nonsense = (body: string): RasterStore =>
      createRemoteStore({
        endpoint: 'http://stub',
        fetch: async () => new Response(body, { status: 200 }),
      });

    expect(await nonsense('{"raster":{"bytes":42}}').renderCache.get('v1:doc', MAC)).toBeNull();
    await expect(nonsense('{"found":{"bytes":42}}').find({ subject: 's' }, MAC)).rejects.toThrow(
      RasterStoreError,
    );
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

  it('refuses a description that does not say which fonts were missing', async () => {
    // The loudest failure of the three if it were allowed through, and the one
    // with a precedent in this repository. Defaulting the field to `[]` reads as
    // "no fonts were missing", which is a *verdict*: the subject settles to a
    // bare `unchanged` while the baseline is an image of a substituted typeface.
    // Absent and empty must not be the same value on a wire, which is exactly
    // what `stabilization` taught here when the identity codec dropped it.
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () =>
        new Response(
          JSON.stringify({
            described: {
              documentDigest: 'v1:doc',
              comparable: true,
              storedUnder: MAC,
              pictured: true,
            },
          }),
          { status: 200 },
        ),
    });

    await expect(store.describe({ subject: 's' }, MAC)).rejects.toThrow(/missingFonts/);
  });

  it('refuses a description whose missing fonts are not strings', async () => {
    const store = createRemoteStore({
      endpoint: 'http://stub',
      fetch: async () =>
        new Response(
          JSON.stringify({
            described: {
              documentDigest: 'v1:doc',
              comparable: true,
              storedUnder: MAC,
              pictured: true,
              missingFonts: [{ family: 'Inter' }],
            },
          }),
          { status: 200 },
        ),
    });

    await expect(store.describe({ subject: 's' }, MAC)).rejects.toThrow(/missingFonts/);
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

/**
 * The working set: one request for what the run will ask about.
 *
 * A run settles most subjects from the sidecar and never moves an image, which
 * is what makes `describe` worth having — and across a hop that saving is spent
 * again as one round trip per subject. These tests count requests, because the
 * count is the whole claim.
 */
describe('a declared working set', () => {
  /** Counts by path, so "one request" is an assertion rather than a description. */
  function counting(): { fetch: typeof globalThis.fetch; paths: string[] } {
    const paths: string[] = [];
    return {
      paths,
      fetch: (input, init) => {
        paths.push(new URL(String(input)).pathname);
        return globalThis.fetch(input, init);
      },
    };
  }

  it('answers every declared subject from one request', async () => {
    const backing = createDurableStore(root);
    await backing.put({ subject: 'a' }, rasterOf(MAC));
    await backing.put({ subject: 'b' }, rasterOf(MAC));
    server = await serveRasterStore(backing);
    const counted = counting();
    const store = createRemoteStore({ endpoint: server.url, fetch: counted.fetch });

    store.expect?.([{ subject: 'a' }, { subject: 'b' }, { subject: 'c' }]);
    const described = [
      await store.describe({ subject: 'a' }, MAC),
      await store.describe({ subject: 'b' }, MAC),
      await store.describe({ subject: 'c' }, MAC),
    ];

    expect(described.map((entry) => entry?.documentDigest ?? null)).toEqual([
      'v1:doc',
      'v1:doc',
      null,
    ]);
    expect(counted.paths).toEqual([BASELINE_WORKING_SET_PATH]);
  });

  it('keeps `comparable` false for another machine`s baseline', async () => {
    // The prefetch must not become a second implementation of the sibling scan
    // with a different answer. It is the server's `describe`, in bulk.
    const backing = createDurableStore(root);
    await backing.put({ subject: 'a' }, rasterOf(RUNNER));
    server = await serveRasterStore(backing);
    const store = createRemoteStore({ endpoint: server.url });

    store.expect?.([{ subject: 'a' }]);

    const described = await store.describe({ subject: 'a' }, MAC);
    expect(described?.comparable).toBe(false);
    expect(described?.storedUnder.platform).toBe('linux/x64');
  });

  it('asks the endpoint for a subject nobody declared', async () => {
    // Declaring narrows what is fetched, never what can be asked. A run that
    // looked up something outside its selection must get an answer, not a miss.
    const backing = createDurableStore(root);
    await backing.put({ subject: 'undeclared' }, rasterOf(MAC));
    server = await serveRasterStore(backing);
    const counted = counting();
    const store = createRemoteStore({ endpoint: server.url, fetch: counted.fetch });

    store.expect?.([{ subject: 'a' }]);
    const described = await store.describe({ subject: 'undeclared' }, MAC);

    expect(described?.documentDigest).toBe('v1:doc');
    expect(counted.paths).toEqual([BASELINE_WORKING_SET_PATH, BASELINE_DESCRIBE_PATH]);
  });

  it('falls back to one request per key against a server without the path', async () => {
    // The path was added to a protocol that is already deployed. A server that
    // has never heard of it still answers every `describe` correctly, so the
    // client degrades to slower rather than to broken.
    const backing = createDurableStore(root);
    await backing.put({ subject: 'a' }, rasterOf(MAC));
    server = await serveRasterStore(backing);
    const url = server.url;
    const counted = counting();
    const store = createRemoteStore({
      endpoint: url,
      fetch: (input, init) =>
        new URL(String(input)).pathname === BASELINE_WORKING_SET_PATH
          ? Promise.resolve(new Response('{"error":"no route"}', { status: 404 }))
          : counted.fetch(input, init),
    });

    store.expect?.([{ subject: 'a' }]);

    expect((await store.describe({ subject: 'a' }, MAC))?.documentDigest).toBe('v1:doc');
    expect(counted.paths).toEqual([BASELINE_DESCRIBE_PATH]);
  });

  it('refuses an unreachable endpoint rather than reading it as an empty set', async () => {
    // The failure this whole file is about, arriving one layer earlier. A
    // prefetch that answered "no baselines" to an outage would record the entire
    // suite as `new` and report success.
    const store = createRemoteStore({ endpoint: await deadEndpoint() });
    store.expect?.([{ subject: 'a' }]);

    await expect(store.describe({ subject: 'a' }, MAC)).rejects.toThrow(RasterStoreError);
  });

  it('sends one request however many subjects ask at once', async () => {
    // The run is concurrent. One in-flight prefetch per identity, or the
    // optimisation becomes as many requests as there are workers.
    const backing = createDurableStore(root);
    await backing.put({ subject: 'a' }, rasterOf(MAC));
    server = await serveRasterStore(backing);
    const counted = counting();
    const store = createRemoteStore({ endpoint: server.url, fetch: counted.fetch });

    store.expect?.([{ subject: 'a' }, { subject: 'b' }]);
    await Promise.all([
      store.describe({ subject: 'a' }, MAC),
      store.describe({ subject: 'b' }, MAC),
      store.describe({ subject: 'a' }, MAC),
    ]);

    expect(counted.paths).toEqual([BASELINE_WORKING_SET_PATH]);
  });
});
