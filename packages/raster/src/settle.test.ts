import { describe, expect, it } from 'vitest';
import {
  documentDigest,
  type RenderDocument,
  type RenderIdentity,
} from '@variance-authority/core/format';
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

    expect(settle(digest, found, IDENTITY)).toEqual({
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

    const settlement = settle(digest, found, IDENTITY);
    expect(settlement.kind).toBe('settled');
    expect(settlement).toMatchObject({ verdict: 'incomparable' });
    // The one field that moved, both sides of it, and nothing the two share: a
    // reader handed two full descriptions has to diff them by eye, and on a
    // seven-field identity that is where the field that moved gets missed.
    expect(settlement.because).toContain('platform darwin/arm64 → linux/x64');
    expect(settlement.because).not.toContain('chromium@131');
    expect(settlement.because).toContain('nothing here was compared');
    expect(settlement.because).not.toMatch(/machine-bound|not comparable/);
  });

  // An upgrade of this tool moved the rasterization key and nothing about the
  // machine (3fdec678 changed what the rasterization digest covers, and no
  // pixel moved with it). Refusing to paint left a run with no
  // candidate, so nothing could be accepted and the only route back was
  // deleting a directory by hand. The recipe is ours, so the run paints.
  const OLD_RECIPE: RenderIdentity = { ...IDENTITY, rasterization: 'v1:8040e1a2e35d148b301ebd30e5ed66c6' };
  const NEW_RECIPE: RenderIdentity = { ...IDENTITY, rasterization: 'v1:54323cded938fde38b41cdd3865368fe' };

  it('renders against this machine under an older recipe of the same document, and says only the recipe moved', () => {
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: false,
      storedUnder: OLD_RECIPE,
      missingFonts: [],
    };

    const settlement = settle(digest, found, NEW_RECIPE);
    expect(settlement.kind).toBe('render');
    expect(settlement.because).toContain('rasterization e5ed66c6 → 865368fe');
    // The document digest is the evidence: the same bytes were sent to the
    // renderer on both sides, so what moved is the recipe and nothing else.
    expect(settlement.because).toContain('the document is the one the baseline was painted from');
    expect(settlement.because).toContain('only the recipe moved');
    expect(settlement.because).toContain('`variance accept --all`');
    expect(settlement.because).not.toContain('machine-bound');
  });

  it('renders against an older recipe of a different document, and does not call the image reviewed', () => {
    // The recipe moved *and* the document did. The new image carries a change
    // nobody has looked at, and a sentence calling it a re-baseline would have
    // `accept --all` adopt that change unread.
    const found: Described = {
      documentDigest: documentDigest(documentFor('fixture:a', '<div data-va-path="0">y</div>')),
      comparable: false,
      storedUnder: OLD_RECIPE,
      missingFonts: [],
    };

    const settlement = settle(digest, found, NEW_RECIPE);
    expect(settlement.kind).toBe('render');
    expect(settlement.because).toContain('rasterization e5ed66c6 → 865368fe');
    expect(settlement.because).toContain('the document changed too');
    expect(settlement.because).toContain('unreviewed');
    expect(settlement.because).not.toContain('only the recipe moved');
    expect(settlement.because).not.toContain('regression');
    expect(settlement.because).not.toContain('--all');
    // Vitest's `--update` is a sweep and skips this subject, so it is no route.
    expect(settlement.because).toContain('`variance accept <subject>`');
    expect(settlement.because).not.toContain('Vitest');
  });

  it('refuses a side that did not record its recipe, since an unrecorded recipe is not a value', () => {
    // Absent means the renderer did not say what it did (`RenderIdentity`), so
    // `recorded → not recorded` is an unknown on one side, not a recipe that
    // moved. Nothing shows the machine is the same, so the refusal stands.
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: false,
      storedUnder: OLD_RECIPE,
      missingFonts: [],
    };

    const settlement = settle(digest, found, IDENTITY);
    expect(settlement).toMatchObject({ kind: 'settled', verdict: 'incomparable' });
    expect(settlement.because).toContain('rasterization e5ed66c6 → not recorded');
    expect(settlement.because).toContain('nothing here was compared');
    expect(settlement.because).not.toMatch(/machine-bound|not comparable/);
    expect(settlement.because).not.toContain('accept');
  });

  it('refuses a recipe re-baseline when the caller did not say what this run paints under', () => {
    // `mine` is optional, as it was before the recipe was told apart: a caller
    // that does not pass it has not said its machine is the baseline's, so the
    // stored image's recipe moving is no evidence of anything and the refusal
    // stands.
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: false,
      storedUnder: OLD_RECIPE,
      missingFonts: [],
    };

    const settlement = settle(digest, found);
    expect(settlement).toMatchObject({ kind: 'settled', verdict: 'incomparable' });
    expect(settlement.because).toContain('rasterization');
    expect(settlement.because).toContain('no image was produced');
    // No image was painted, so there is no second one to call one of two.
    expect(settlement.because).toContain('nothing here was compared');
    expect(settlement.because).not.toMatch(/these two|two images/);
    expect(settlement.because).not.toMatch(/machine-bound|not comparable/);
    expect(settlement.because).not.toContain('accept');
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

    const settlement = settle(digest, found, IDENTITY);
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
    expect(settle(digest, found, IDENTITY).kind).toBe('render');
  });

  it('renders when there is no baseline, so the subject can be accepted at all', () => {
    // The verdict `new` needs no image; `accept` does, and `accept` may never
    // re-render. This is the one render this function knowingly pays for.
    expect(settle(digest, null, IDENTITY)).toEqual({
      kind: 'render',
      because: expect.stringContaining('no baseline'),
    });
  });

  it.todo(
    'the share of subjects `settle` answers without a render is a measured number — needs a checkout with pull-request history and one run per pull request, which is what spec §10 asks for with `>70% screenshot-skip on typical PRs`',
  );
});
