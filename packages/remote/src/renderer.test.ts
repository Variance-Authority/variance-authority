import { afterEach, describe, expect, it } from 'vitest';
import type { Raster, RenderDocument, RenderIdentity, Viewport } from '@variance-authority/core';
import { documentDigest } from '@variance-authority/core';
import { identityAtScale, type Renderer } from '@variance-authority/raster';
import { connectRenderer, serveRenderer, type RenderServer } from './renderer.js';

/**
 * The offload path, over a real socket.
 *
 * Round-tripping through the handler in-process would test the wrong thing. The
 * claim being made is that a render can happen *somewhere else* — on the one
 * machine whose pixels are pinned, while the tier that decides almost everything
 * runs wherever is cheapest — and that claim is about serialization and identity,
 * both of which a direct function call quietly satisfies.
 */

const VIEWPORT: Viewport = { width: 100, height: 100, deviceScaleFactor: 2, colorScheme: 'dark' };

const PINNED: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 2,
  fonts: ['Inter/400/normal/abc'],
};

function documentOf(html: string): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id: 'story:a', kind: 'story' },
    html,
    frame: { html: { class: 'dark' }, body: {}, ancestors: [], containerWidth: 640 },
    css: ['[data-va-path="0"]{color:red}'],
    viewport: VIEWPORT,
    inherited: { '--brand': '#f00' },
    fonts: ['Inter/400/normal/abc'],
    diagnostics: [],
  };
}

/** Records what actually arrived, which is the only thing this file is testing. */
function echoRenderer(): Renderer & { seen: RenderDocument[] } {
  const renderer = {
    identity: PINNED,
    seen: [] as RenderDocument[],
    identityFor(document: RenderDocument): RenderIdentity {
      return identityAtScale(PINNED, document);
    },
    async render(document: RenderDocument): Promise<Raster> {
      renderer.seen.push(document);
      return {
        documentDigest: documentDigest(document),
        identity: renderer.identityFor(document),
        width: 200,
        height: 100,
        bytes: Buffer.from(document.html).toString('base64'),
        missingFonts: [],
      };
    },
    async close(): Promise<void> {},
  };
  return renderer;
}

/** A far end that paints at its own scale regardless of what it was sent. */
function stubbornRenderer(deviceScaleFactor: number): Renderer {
  const identity: RenderIdentity = { ...PINNED, deviceScaleFactor };
  return {
    identity,
    identityFor: () => identity,
    async render(document: RenderDocument): Promise<Raster> {
      return {
        documentDigest: documentDigest(document),
        identity,
        width: 100,
        height: 100,
        bytes: '',
        missingFonts: [],
      };
    },
    async close(): Promise<void> {},
  };
}

let server: RenderServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('rendering somewhere else', () => {
  it('carries the document across the wire without losing any of it', async () => {
    const local = echoRenderer();
    server = await serveRenderer(local);

    const remote = await connectRenderer({ endpoint: server.url });
    await remote.render(documentOf('<div data-va-path="0">hello</div>'));

    // A document is plain serializable data by construction (ADR-0006). The
    // fields most likely to be quietly dropped are the ones that decide the
    // image: the ancestor frame, the container width, the inherited floor.
    const [arrived] = local.seen;
    expect(arrived).toEqual(documentOf('<div data-va-path="0">hello</div>'));
  });

  it('addresses the same document identically on both sides of the hop', async () => {
    const local = echoRenderer();
    server = await serveRenderer(local);
    const remote = await connectRenderer({ endpoint: server.url });

    const document = documentOf('<div data-va-path="0">hello</div>');
    const raster = await remote.render(document);

    // Content addressing has to survive JSON, or an offloaded render can never
    // hit the cache that makes offloading affordable.
    expect(raster.documentDigest).toBe(documentDigest(document));
  });

  it('learns the remote identity rather than being told it', async () => {
    // A caller who declares the far end's identity can make a misconfigured
    // endpoint pass a comparability check it should fail — which is a confident
    // diff between two different machines, the exact thing durable mode refuses.
    server = await serveRenderer(echoRenderer());
    const remote = await connectRenderer({ endpoint: server.url });

    expect(remote.identity).toEqual(PINNED);
  });

  it('reports a render failure as a failure, never as a blank image', async () => {
    // A renderer that answers a broken document with an empty PNG produces a
    // comparison saying the whole subject changed, and the report then blames
    // whichever component sits under the pixels.
    server = await serveRenderer({
      identity: PINNED,
      identityFor: () => PINNED,
      async render(): Promise<Raster> {
        throw new Error('subject root has no box in the rendered document');
      },
      async close(): Promise<void> {},
    });

    const remote = await connectRenderer({ endpoint: server.url });

    await expect(remote.render(documentOf('<div data-va-path="0"></div>'))).rejects.toThrow(
      /no box in the rendered document/,
    );
  });

  it('fails a request that hangs rather than stalling the run', async () => {
    server = await serveRenderer({
      identity: PINNED,
      identityFor: () => PINNED,
      render: () => new Promise<Raster>(() => {}),
      async close(): Promise<void> {},
    });

    const remote = await connectRenderer({ endpoint: server.url, timeoutMs: 50 });

    await expect(remote.render(documentOf('<div data-va-path="0">x</div>'))).rejects.toThrow();
  });

  it('predicts the identity a document will come back under, at the document`s scale', async () => {
    // The lookup key a durable run commits to before the hop. Reading it off
    // `identity` would ask for the far end's default scale, not this document's,
    // and the baseline would then be written under one key and searched for
    // under another.
    server = await serveRenderer(echoRenderer());
    const remote = await connectRenderer({ endpoint: server.url });

    const document = documentOf('<div data-va-path="0">x</div>');
    const raster = await remote.render(document);

    expect(remote.identityFor(document)).toEqual(raster.identity);
    expect(remote.identityFor(document).deviceScaleFactor).toBe(VIEWPORT.deviceScaleFactor);
  });

  it('refuses a raster the far end rendered under a different identity', async () => {
    // Silence here is the expensive failure: the caller has already keyed its
    // baseline lookup on the predicted identity, so storing a raster stamped
    // with another one files the image where nothing reads it, and every later
    // run calls the subject new or incomparable while the endpoint looks fine.
    server = await serveRenderer(stubbornRenderer(1));
    const remote = await connectRenderer({ endpoint: server.url });

    await expect(remote.render(documentOf('<div data-va-path="0">x</div>'))).rejects.toThrow(
      /stored and looked up under different keys/,
    );
  });
});
