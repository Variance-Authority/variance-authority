import { describe, expect, it } from 'vitest';
import type { Raster, RenderDocument, RenderIdentity, Viewport } from '@variance-authority/core';
import { documentDigest } from '@variance-authority/core';
import { createEphemeralStore, identityFrom, rasterFrom, renderCached } from './store.js';
import { identityAtScale, type Renderer } from './renderer.js';

/**
 * The ephemeral mode — and the fact that it needs nothing.
 *
 * Both images are produced now, by one renderer, and thrown away, so the machine
 * cancels out by construction. There is no container to pin, no runner to match,
 * and no stored artifact. This file is where that argument stops being a claim in
 * a comment: it imports no filesystem and no socket, because the mode does not
 * have one.
 *
 * The disk-backed and wire-backed stores are tested where they live —
 * `@variance-authority/store` and `@variance-authority/remote` — against the same
 * contract, which is declared here.
 */

const VIEWPORT: Viewport = { width: 100, height: 100, deviceScaleFactor: 1, colorScheme: 'light' };

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

/** Same browser, different machine. */
const RUNNER: RenderIdentity = { ...MAC, platform: 'linux/x64' };

function rasterOf(identity: RenderIdentity, digest = 'v1:doc', bytes = 'AAAA'): Raster {
  return { documentDigest: digest, identity, width: 10, height: 10, bytes, missingFonts: [] };
}

function documentOf(html: string): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id: 's', kind: 'fixture' },
    html,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

/** A renderer that paints nothing and counts how often it was asked to. */
function countingRenderer(identity: RenderIdentity): Renderer & { calls: number } {
  const renderer = {
    identity,
    calls: 0,
    identityFor: (document: RenderDocument): RenderIdentity =>
      identityAtScale(identity, document),
    async render(document: RenderDocument): Promise<Raster> {
      renderer.calls += 1;
      return {
        ...rasterOf(identity, documentDigest(document)),
        identity: renderer.identityFor(document),
      };
    },
    async close(): Promise<void> {},
  };
  return renderer;
}

describe('the ephemeral mode', () => {
  it('has no past, so it never claims one', () => {
    // Both images are rendered in this run by one renderer, so there is no
    // stored artifact and no second machine to be wrong about.
    const store = createEphemeralStore();
    return expect(store.find({ subject: 's' }, MAC)).resolves.toBeNull();
  });

  it('renders a document once however often it is asked for', async () => {
    const store = createEphemeralStore();
    const renderer = countingRenderer(MAC);
    const document = documentOf('<div data-va-path="0">x</div>');

    const first = await renderCached(renderer, store, document);
    const second = await renderCached(renderer, store, document);

    expect(first.rendered).toBe(true);
    expect(second.rendered).toBe(false);
    expect(renderer.calls).toBe(1);
  });

  it('re-renders when the document changes, and only then', async () => {
    const store = createEphemeralStore();
    const renderer = countingRenderer(MAC);

    await renderCached(renderer, store, documentOf('<div data-va-path="0">x</div>'));
    await renderCached(renderer, store, documentOf('<div data-va-path="0">y</div>'));
    await renderCached(renderer, store, documentOf('<div data-va-path="0">x</div>'));

    expect(renderer.calls).toBe(2);
  });

  it('does not serve one machine`s render to another', async () => {
    const store = createEphemeralStore();
    const document = documentOf('<div data-va-path="0">x</div>');

    await renderCached(countingRenderer(MAC), store, document);
    const other = countingRenderer(RUNNER);
    await renderCached(other, store, document);

    expect(other.calls).toBe(1);
  });

  it('has nothing to describe either, and says so the same way', async () => {
    expect(await createEphemeralStore().describe({ subject: 's' }, MAC)).toBeNull();
  });
});

/**
 * The checks a record passes before it is believed, wherever it arrived from.
 *
 * A disk and a socket hand over the same value by different routes, so they are
 * checked by the same code. Two copies of this would be two ideas of what a
 * baseline is, and where a baseline is kept must decide nothing about what it
 * means.
 */
describe('a record that claims to be a raster', () => {
  it('is refused when it does not carry the machine that painted it', () => {
    expect(rasterFrom({ documentDigest: 'v1:d', width: 1, height: 1, bytes: 'AA' })).toBeNull();
  });

  it('is refused when the identity is missing the scale it was painted at', () => {
    // The field that went wrong once already: a lookup keyed on an identity
    // without a scale finds a 1x baseline for a 2x image and calls it comparable.
    expect(identityFrom({ ...MAC, deviceScaleFactor: undefined })).toBeNull();
  });

  it('is accepted whole, or not at all', () => {
    expect(rasterFrom(rasterOf(MAC))).toEqual(rasterOf(MAC));
  });
});
