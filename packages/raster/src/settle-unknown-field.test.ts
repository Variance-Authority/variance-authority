import { describe, expect, it, vi } from 'vitest';
import {
  documentDigest,
  type RenderDocument,
  type RenderIdentity,
} from '@variance-authority/core/format';
import { settle } from './settle.js';
import type { Described } from './store.js';

/**
 * A field the identity digest covers and the refusal's wording does not name.
 *
 * `RenderIdentity` grows: the digest is what partitions baselines, and a field
 * added to it is a field two machines can differ in. The settlement decides
 * "only the recipe moved" by asking the digest, so a field the wording has not
 * learned yet is still a difference — and a run that differs in it, under a
 * moved recipe besides, is refused rather than painted for `accept --all` to
 * adopt another machine's image.
 *
 * The field is simulated by widening `identityDigest`, its owner, in this file
 * alone: no field the digest covers today is outside the wording's list, which
 * is the state this pins against changing silently.
 */
vi.mock('@variance-authority/core/format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@variance-authority/core/format')>();
  return {
    ...actual,
    identityDigest: (identity: RenderIdentity & { readonly antialias?: string }) =>
      `${actual.identityDigest(identity)}+${identity.antialias ?? ''}`,
  };
});

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const document: RenderDocument = {
  documentVersion: 1,
  subject: { id: 'fixture:a', kind: 'fixture' },
  html: '<div data-va-path="0">x</div>',
  frame: { html: {}, body: {}, ancestors: [] },
  css: [],
  viewport: { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' },
  inherited: {},
  fonts: [],
  diagnostics: [],
};

describe('a recipe move alongside a field the wording does not name', () => {
  it('refuses, and paints nothing', () => {
    const stored = {
      ...IDENTITY,
      rasterization: 'v1:8040e1a2e35d148b301ebd30e5ed66c6',
      antialias: 'grayscale',
    } as RenderIdentity;
    const mine = {
      ...IDENTITY,
      rasterization: 'v1:54323cded938fde38b41cdd3865368fe',
      antialias: 'subpixel',
    } as RenderIdentity;
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: false,
      storedUnder: stored,
      missingFonts: [],
    };

    const settlement = settle(documentDigest(document), found, mine);
    expect(settlement).toMatchObject({ kind: 'settled', verdict: 'incomparable' });
    expect(settlement.because).toContain('rasterization e5ed66c6 → 865368fe');
    expect(settlement.because).not.toContain('only the recipe moved');
    expect(settlement.because).not.toContain('accept');
    expect(settlement.because).toContain('no image was produced');
  });
});

describe('a field the wording does not name, and nothing else', () => {
  it('refuses with both machines described in full, since no narrower sentence is true', () => {
    const stored = { ...IDENTITY, antialias: 'grayscale' } as RenderIdentity;
    const mine = { ...IDENTITY, antialias: 'subpixel' } as RenderIdentity;
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: false,
      storedUnder: stored,
      missingFonts: [],
    };

    const settlement = settle(documentDigest(document), found, mine);
    expect(settlement).toMatchObject({ kind: 'settled', verdict: 'incomparable' });
    expect(settlement.because).toContain('was painted by');
    expect(settlement.because).toContain('playwright-chromium');
    expect(settlement.because).toContain('nothing here was compared');
    expect(settlement.because).not.toMatch(/machine-bound|not comparable/);
    expect(settlement.because).not.toContain('only the recipe moved');
  });
});
