import { describe, expect, it } from 'vitest';
import { documentDigest, type RenderIdentity } from '@variance-authority/core';
import type { Described } from '@variance-authority/raster';
import { settle } from './run.js';
import { IDENTITY, documentFor } from './run-fixture.js';

/**
 * The settlement, which is the economy the whole command rests on.
 *
 * Asserted against a hand-built `Described` rather than through a run, because
 * the claim being pinned is that these answers are reached *without a renderer* —
 * a test that reached them through one could not tell a settlement from a fast
 * comparison.
 */

const OTHER_MACHINE: RenderIdentity = { ...IDENTITY, platform: 'darwin/arm64' };

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
});
