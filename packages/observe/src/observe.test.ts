import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  documentDigest,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
  type Viewport,
} from '@variance-authority/core';
import type { Renderer } from '@variance-authority/raster';
import { createDurableStore } from '@variance-authority/store';
import { observeAgainstBaseline } from './observe.js';

/**
 * The durable mode at a scale factor other than 1.
 *
 * Every image in this file is built pixel by pixel rather than rendered, because
 * the claim under test is not about painting. It is about *which key* a baseline
 * is written under and *which key* it is looked up under — an arithmetic
 * question that a browser would only obscure.
 */

const MACHINE: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  // A renderer knows its machine before it sees a document, and a document is
  // what supplies the scale. This is the placeholder every real renderer carries.
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

/** White, opaque, and identical every time, so a comparison of it with itself is empty. */
const IMAGE = ((): string => {
  const image = new PNG({ width: 20, height: 20 });
  image.data.fill(0xff);
  return PNG.sync.write(image).toString('base64');
})();

function viewportAt(deviceScaleFactor: number): Viewport {
  return { width: 100, height: 100, deviceScaleFactor, colorScheme: 'light' };
}

function documentAt(deviceScaleFactor: number): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id: 's', kind: 'fixture' },
    html: '<div data-va-path="0">x</div>',
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: viewportAt(deviceScaleFactor),
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

/**
 * A renderer that behaves the way every real one does: machine identity up
 * front, the document's scale folded in at render time.
 */
function fakeRenderer(): Renderer & { calls: number } {
  const renderer = {
    identity: MACHINE,
    calls: 0,
    identityFor(document: RenderDocument): RenderIdentity {
      return { ...MACHINE, deviceScaleFactor: document.viewport.deviceScaleFactor };
    },
    async render(document: RenderDocument): Promise<Raster> {
      renderer.calls += 1;
      return {
        documentDigest: documentDigest(document),
        identity: renderer.identityFor(document),
        width: 20,
        height: 20,
        bytes: IMAGE,
        missingFonts: [],
      };
    },
    async close(): Promise<void> {},
  };
  return renderer;
}

describe('a durable observation above 1x', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'va-observe-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finds the baseline this run itself wrote at 2x', async () => {
    // The raster is stamped with the document's scale, so a 2x baseline is
    // stored under a 2x identity. Looking it up under the renderer's
    // machine-level identity asks for 1x, misses the run's own write, and then
    // locates it as a *sibling* identity — reporting `incomparable` on every
    // run, forever, in a sentence that blames the machine for a key mismatch.
    const store = createDurableStore(root);
    const renderer = fakeRenderer();
    const document = documentAt(2);

    await store.put({ subject: 's' }, await renderer.render(document));

    const observation = await observeAgainstBaseline(document, { subject: 's' }, { renderer, store });

    expect(observation.verdict).toBe('unchanged');
  });

  it('still refuses a 1x baseline from a 2x run, and names the scale it ran at', async () => {
    // The refusal has to survive the fix. A retina laptop and a 1x runner paint
    // different images of the same markup, so comparing them is a diff of the
    // machines and `unchanged` is never available for it. The sentence has to
    // quote the scale this run actually rendered at, not the renderer's
    // placeholder 1 — a report that says "1x" of a 2x run sends the reader
    // hunting for a machine difference that is not there.
    const store = createDurableStore(root);
    const renderer = fakeRenderer();

    await store.put({ subject: 's' }, await renderer.render(documentAt(1)));

    const observation = await observeAgainstBaseline(
      documentAt(2),
      { subject: 's' },
      { renderer, store },
    );

    expect(observation.verdict).toBe('incomparable');

    // Both sides, and the scale on each. Matched on the prefix rather than the
    // whole parenthesis because `describeIdentity` also prints the fonts and the
    // stabilization recipe — the two fields the digest covers and the sentence
    // used to omit, which is how an identity mismatch came to be reported as two
    // identical descriptions of one machine.
    expect(observation.because).toContain(
      'this run is playwright-chromium (chromium@131.0.0, darwin/arm64, 2x,',
    );
    expect(observation.because).toContain('rendered by playwright-chromium (chromium@131.0.0, darwin/arm64, 1x,');
  });

  it('reuses a 2x render instead of paying for it twice', async () => {
    // The same key mismatch on the cache half. The store writes a render under
    // the raster's identity and is asked for it under the renderer's, so above
    // 1x the lookup misses its own write every time and the deferral lever —
    // the thing that makes a 300-subject run affordable — is off precisely
    // where images cost the most.
    const store = createDurableStore(root);
    const renderer = fakeRenderer();
    const document = documentAt(2);

    await observeAgainstBaseline(document, { subject: 's' }, { renderer, store });
    await observeAgainstBaseline(document, { subject: 's' }, { renderer, store });

    expect(renderer.calls).toBe(1);
  });
});
