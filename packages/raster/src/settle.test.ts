import { describe, expect, it } from 'vitest';
import {
  documentDigest,
  type RenderDocument,
  type RenderIdentity,
} from '@variance-authority/core';
import { settle } from './settle.js';
import type { Described } from './store.js';

/**
 * The settlement, which is the economy the whole command rests on.
 *
 * Asserted against a hand-built `Described` rather than through a run, because
 * the claim being pinned is that these answers are reached *without a renderer* —
 * a test that reached them through one could not tell a settlement from a fast
 * comparison.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  // 1 here, as a real renderer reports it: the document's viewport supplies the
  // scale a raster is actually painted at.
  deviceScaleFactor: 1,
  fonts: [],
};

const OTHER_MACHINE: RenderIdentity = { ...IDENTITY, platform: 'darwin/arm64' };

/** Built here rather than imported: this file may not depend on a composition. */
function documentFor(id: string, html = '<div data-va-path="0">x</div>'): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id, kind: 'fixture' },
    html,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' },
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

describe('settle', () => {
  const document = documentFor('fixture:a');
  const digest = documentDigest(document);

  it('settles `unchanged` when the baseline was painted from this exact document', () => {
    // The economy the whole command rests on: a render document states everything
    // sent to a renderer, so an identical one under an identical identity cannot
    // produce a different image. No browser is asked.
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: true,
      storedUnder: IDENTITY,
      missingFonts: [],
    };

    expect(settle(digest, found)).toEqual({
      kind: 'settled',
      verdict: 'unchanged',
      because: expect.stringContaining('byte-identical'),
    });
  });

  it('refuses to render against a baseline another machine painted', () => {
    // Rendering here would buy a large, confident diff caused by a font stack or
    // a driver, which the report would then blame on a component.
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: false,
      storedUnder: OTHER_MACHINE,
      missingFonts: [],
    };

    const settlement = settle(digest, found);
    expect(settlement.kind).toBe('settled');
    expect(settlement).toMatchObject({ verdict: 'incomparable' });
    expect(settlement.because).toContain('darwin/arm64');
  });

  it('keeps the fonts the baseline was painted without when the digest settles it', () => {
    // The digest is sound about pixels and says nothing about fonts. A baseline
    // painted while the renderer lacked Inter is an image of a substituted font,
    // and answering a repeat of that document with a bare `unchanged` drops a fact
    // the baseline itself recorded — the reader is then told the subject is fine
    // by a comparison that never mentioned it is looking at the wrong typeface.
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: true,
      storedUnder: IDENTITY,
      missingFonts: ['Inter'],
    };

    const settlement = settle(digest, found);
    expect(settlement).toMatchObject({ kind: 'settled', missingFonts: ['Inter'] });
    expect(settlement.because).toContain('substituted font');
  });

  it('renders when the document moved', () => {
    const found: Described = {
      documentDigest: documentDigest(documentFor('fixture:a', '<div data-va-path="0">y</div>')),
      comparable: true,
      storedUnder: IDENTITY,
      missingFonts: [],
    };
    expect(settle(digest, found).kind).toBe('render');
  });

  it('renders when there is no baseline, so the subject can be accepted at all', () => {
    // The verdict `new` needs no image; `accept` does, and `accept` may never
    // re-render. This is the one render this function knowingly pays for.
    expect(settle(digest, null)).toEqual({
      kind: 'render',
      because: expect.stringContaining('no baseline'),
    });
  });

  it.todo(
    'the share of subjects `settle` answers without a render is a measured number — needs a checkout with pull-request history and one run per pull request, which is what spec §10 asks for with `>70% screenshot-skip on typical PRs`',
  );
});
