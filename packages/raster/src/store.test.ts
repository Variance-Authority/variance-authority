import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderDocument, RenderIdentity, Viewport } from '@variance-authority/core';
import { documentDigest } from '@variance-authority/core';
import { createDurableStore, createEphemeralStore, renderCached } from './store.js';
import type { Renderer } from './renderer.js';

/**
 * Retention: the two modes, and the one rule that separates them.
 *
 * Durable images cross time and therefore cross machines, and pixels do not
 * survive that. Ephemeral images do not cross anything. Everything below is
 * about making the first refuse what the second never has to ask.
 */

const VIEWPORT: Viewport = { width: 100, height: 100, deviceScaleFactor: 1, colorScheme: 'light' };

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

/** Same browser, different machine. The case the durable mode exists for. */
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
    async render(document: RenderDocument): Promise<Raster> {
      renderer.calls += 1;
      return rasterOf(identity, documentDigest(document));
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
});

describe('the durable mode', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'va-raster-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips a baseline for the machine that wrote it', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'todo--empty' }, rasterOf(MAC, 'v1:doc', 'QUJD'));

    const found = await store.find({ subject: 'todo--empty' }, MAC);

    expect(found?.comparable).toBe(true);
    expect(found?.raster.bytes).toBe('QUJD');
  });

  it('finds another machine`s baseline and refuses to call it comparable', async () => {
    // The whole rule. Returning `null` here would report "new subject", and
    // "we have never seen this" is a different and far less useful sentence
    // than "we have seen this, on a machine you are not".
    const store = createDurableStore(root);
    await store.put({ subject: 'todo--empty' }, rasterOf(RUNNER));

    const found = await store.find({ subject: 'todo--empty' }, MAC);

    expect(found).not.toBeNull();
    expect(found?.comparable).toBe(false);
    expect(found?.storedUnder.platform).toBe('linux/x64');
  });

  it('separates baselines by scale factor', async () => {
    // A retina laptop and a 1x runner paint different images of the same page.
    // Sharing a baseline between them is a diff of the machines.
    const store = createDurableStore(root);
    await store.put({ subject: 's' }, rasterOf({ ...MAC, deviceScaleFactor: 2 }));

    const found = await store.find({ subject: 's' }, MAC);
    expect(found?.comparable).toBe(false);
  });

  it('separates baselines by label, so one subject can hold several', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 's', label: 'wide' }, rasterOf(MAC, 'v1:a', 'QQ=='));
    await store.put({ subject: 's', label: 'narrow' }, rasterOf(MAC, 'v1:b', 'Qg=='));

    expect((await store.find({ subject: 's', label: 'wide' }, MAC))?.raster.bytes).toBe('QQ==');
    expect((await store.find({ subject: 's', label: 'narrow' }, MAC))?.raster.bytes).toBe('Qg==');
  });

  it('reports nothing for a subject nobody has ever rendered', async () => {
    const store = createDurableStore(root);
    expect(await store.find({ subject: 'never-seen' }, MAC)).toBeNull();
  });

  it('survives a subject id that is not a filename', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'components/Button--primary state' }, rasterOf(MAC));

    const found = await store.find({ subject: 'components/Button--primary state' }, MAC);
    expect(found?.comparable).toBe(true);
  });

  it('caches renders across runs, keyed by what is painted', async () => {
    // The deferral lever surviving process exit: an unchanged document under an
    // unchanged identity has an image already, so a run over 300 subjects where
    // two changed pays for two images.
    const document = documentOf('<div data-va-path="0">x</div>');

    const first = countingRenderer(MAC);
    await renderCached(first, createDurableStore(root), document);

    const second = countingRenderer(MAC);
    const result = await renderCached(second, createDurableStore(root), document);

    expect(second.calls).toBe(0);
    expect(result.rendered).toBe(false);
  });
});
