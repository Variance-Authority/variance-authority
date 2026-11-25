import { describe, expect, it } from 'vitest';
import {
  documentDigest,
  type RenderDocument,
  type RenderIdentity,
  type SemanticSnapshot,
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

/** What this run collected, for the one rule that asks whether it has a tree to record. */
const COLLECTED = { root: { path: '0', tag: 'div', attributes: {}, style: {}, children: [] } } as unknown as SemanticSnapshot;

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

  it('renders against a baseline another machine painted, and names the field that moved', () => {
    // A different machine is the cause of whatever the comparison finds, never
    // a reason to skip it: a browser upgrade moves every subject at once, and a
    // reviewer needs each diff to find the few that are regressions.
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: false,
      storedUnder: OTHER_MACHINE,
      missingFonts: [],
    };

    const settlement = settle(digest, found, IDENTITY);
    expect(settlement.kind).toBe('render');
    // The one field that moved, both sides of it, and nothing the two share.
    expect(settlement.because).toContain('platform darwin/arm64 → linux/x64');
    expect(settlement.because).not.toContain('chromium@131');
    expect(settlement.because).not.toContain('nothing here was compared');
  });

  // An upgrade of this tool moved the rasterization key and nothing about the
  // machine. The recipe is a cause like any other: the run paints and compares.
  const OLD_RECIPE: RenderIdentity = { ...IDENTITY, rasterization: 'v1:8040e1a2e35d148b301ebd30e5ed66c6' };
  const NEW_RECIPE: RenderIdentity = { ...IDENTITY, rasterization: 'v1:54323cded938fde38b41cdd3865368fe' };

  it('renders against an older recipe and names the recipe as what moved', () => {
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: false,
      storedUnder: OLD_RECIPE,
      missingFonts: [],
    };

    const settlement = settle(digest, found, NEW_RECIPE);
    expect(settlement.kind).toBe('render');
    expect(settlement.because).toContain('rasterization e5ed66c6 → 865368fe');
  });

  it('renders against a side that did not record its recipe, and names the unknown', () => {
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: false,
      storedUnder: OLD_RECIPE,
      missingFonts: [],
    };

    const settlement = settle(digest, found, IDENTITY);
    expect(settlement.kind).toBe('render');
    expect(settlement.because).toContain('rasterization e5ed66c6 → not recorded');
  });

  it('renders when the caller did not say what this run paints under', () => {
    // The comparison after the render names what moved; refusing here would
    // leave a subject with two images and no diff.
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: false,
      storedUnder: OLD_RECIPE,
      missingFonts: [],
    };

    const settlement = settle(digest, found);
    expect(settlement.kind).toBe('render');
    expect(settlement.because).toContain('another identity');
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

  it('renders a photographed baseline that kept no snapshot, so an accepting run records one', () => {
    // The digest says no pixel can differ, but the baseline is worse than a fresh
    // one: a changed region is joined against the nodes it kept, and it kept
    // none. Settled, it would gain them only by accepting the change they were
    // needed for — as a baseline painted under another identity would keep naming
    // the move.
    const found: Described = {
      documentDigest: digest,
      comparable: true,
      storedUnder: IDENTITY,
      pictured: true,
      keepsSnapshot: false,
      missingFonts: [],
    };

    expect(settle(digest, found, IDENTITY, undefined, COLLECTED)).toEqual({
      kind: 'render',
      because: expect.stringContaining('records no snapshot of its nodes'),
    });
  });

  it('settles a baseline that kept no snapshot when this run has none to record either', () => {
    // Rendered, it would render on every run and gain nothing: no run of this
    // profile can write the tree it lacks.
    const found: Described = {
      documentDigest: digest,
      comparable: true,
      storedUnder: IDENTITY,
      pictured: true,
      keepsSnapshot: false,
      missingFonts: [],
    };

    expect(settle(digest, found, IDENTITY).kind).toBe('settled');
  });

  it('settles a photographed baseline that kept its snapshot', () => {
    const found: Described = {
      documentDigest: digest,
      comparable: true,
      storedUnder: IDENTITY,
      pictured: true,
      keepsSnapshot: true,
      missingFonts: [],
    };

    expect(settle(digest, found, IDENTITY, undefined, COLLECTED).kind).toBe('settled');
  });

  it('settles a baseline with no pixels whatever it kept, since no region is joined there', () => {
    const found: Described = {
      documentDigest: digest,
      comparable: true,
      storedUnder: IDENTITY,
      pictured: false,
      keepsSnapshot: false,
      missingFonts: [],
    };

    expect(settle(digest, found, IDENTITY, undefined, COLLECTED).kind).toBe('settled');
  });

  it('renders a baseline read from where an earlier layout kept it, so an accepting run moves it', () => {
    // Settled, the subject would keep its old path for as long as its document
    // holds: a settled subject produces no observation, and accept moves only
    // what an observation names.
    const found: Described = {
      documentDigest: digest,
      comparable: true,
      storedUnder: IDENTITY,
      missingFonts: [],
      relocated: { from: 'v1-abc/button', to: 'Components/Button/Primary-chromium' },
    };

    expect(settle(digest, found, IDENTITY)).toEqual({
      kind: 'render',
      because: expect.stringMatching(/read from v1-abc\/button.*Components\/Button\/Primary-chromium/),
    });
  });

  it.todo(
    'the share of subjects `settle` answers without a render is a measured number — needs a checkout with pull-request history and one run per pull request, which is what spec §10 asks for with `>70% screenshot-skip on typical PRs`',
  );
});
