import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  documentDigest,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
  type SemanticSnapshot,
  type Viewport,
} from '@variance-authority/core';
import { createEphemeralStore, type Renderer } from '@variance-authority/raster';
import { declaredIgnores } from './decide.js';
import { observePair } from './observe.js';

/**
 * The raster half of an ignore, at the seam where a verdict is decided.
 *
 * Every image here is built pixel by pixel rather than painted, because the claim
 * is arithmetic: given a subtree the operator excluded and a change inside it,
 * does the comparison come back green *and say so in a word that is not
 * `unchanged`*. A browser would only make that harder to see.
 *
 * The scale factor is deliberately 2. An ignore is declared in CSS pixels on a
 * document and applied to device pixels on a raster, and a conversion that is
 * silently wrong lands every box in the top-left quadrant — silencing whatever
 * happens to be there and leaving the real thing reported. At 1x that bug is
 * invisible.
 */

const MACHINE: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

const VIEWPORT: Viewport = { width: 60, height: 60, deviceScaleFactor: 2, colorScheme: 'light' };

/** 120×120 device pixels: white, with an optional black square. */
function image(square: { x: number; y: number; size: number } | null): string {
  const png = new PNG({ width: 120, height: 120 });
  png.data.fill(0xff);

  if (square !== null) {
    for (let y = square.y; y < square.y + square.size; y += 1) {
      for (let x = square.x; x < square.x + square.size; x += 1) {
        const index = (y * 120 + x) * 4;
        png.data[index] = 0;
        png.data[index + 1] = 0;
        png.data[index + 2] = 0;
      }
    }
  }

  return PNG.sync.write(png).toString('base64');
}

function documentFor(id: string): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id, kind: 'fixture' },
    html: `<div data-va-path="0">${id}</div>`,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

/**
 * A snapshot whose root spans the subject, with an excluded child.
 *
 * Rects are CSS pixels in page space, exactly as a collector records them. The
 * root's own rect is the raster's origin, so the excluded box sits at
 * `(10-0, 10-0) × 2 = (20, 20)` in device pixels and covers `20×20` of them.
 */
function snapshotWith(sites: SemanticSnapshot['ignoreSites']): SemanticSnapshot {
  return {
    formatVersion: 1,
    subject: { id: 's', kind: 'fixture' },
    profile: {
      id: 'chromium',
      layout: true,
      computedStyle: true,
      accessibility: 'engine',
      pseudoElements: true,
      raster: true,
    },
    environment: { inputs: {}, digest: 'v1:x', semanticDigest: 'v1:y' } as never,
    renderHash: 'v1:r',
    structureHash: 'v1:s',
    styleHash: 'v1:t',
    root: {
      path: '0',
      tag: 'div',
      attributes: {},
      style: {},
      rect: { x: 0, y: 0, width: 60, height: 60 },
      children: [
        {
          path: '0/0',
          tag: 'time',
          attributes: {},
          style: {},
          rect: { x: 10, y: 10, width: 10, height: 10 },
          children: [],
          ...(sites !== undefined ? { ignoredBy: ['clock'] } : {}),
        },
      ],
    },
    styleProvenance: [],
    ...(sites !== undefined ? { ignoreSites: sites } : {}),
    diagnostics: [],
  };
}

const CLOCK_SITE = [{ path: '0/0', rule: 'clock', rect: { x: 10, y: 10, width: 10, height: 10 } }];

function rendererFor(images: ReadonlyMap<string, string>): Renderer {
  return {
    identity: MACHINE,
    identityFor(document) {
      return { ...MACHINE, deviceScaleFactor: document.viewport.deviceScaleFactor };
    },
    async render(document): Promise<Raster> {
      return {
        documentDigest: documentDigest(document),
        identity: { ...MACHINE, deviceScaleFactor: document.viewport.deviceScaleFactor },
        width: 120,
        height: 120,
        bytes: images.get(document.subject.id)!,
        missingFonts: [],
      };
    },
    async close() {
      /* nothing to release */
    },
  };
}

async function compare(
  before: string,
  after: string,
  snapshot: SemanticSnapshot,
): ReturnType<typeof observePair> {
  const left = documentFor('before');
  const right = documentFor('after');

  return await observePair(left, right, {
    renderer: rendererFor(new Map([['before', before], ['after', after]])),
    store: createEphemeralStore(),
    snapshot,
  });
}

describe('a change entirely inside an excluded subtree', () => {
  // The excluded element occupies CSS (10,10)–(20,20), i.e. device (20,20)–(40,40).
  const inside = image({ x: 24, y: 24, size: 8 });
  const blank = image(null);

  it('is green, and the word is not `unchanged`', async () => {
    const observation = await compare(blank, inside, snapshotWith(CLOCK_SITE));

    expect(observation.verdict).toBe('ignored');
    expect(observation.ignored?.pixels).toBe(64);
  });

  it('is `changed` when the same run has no ignore declared', async () => {
    // The control. Without this the test above would pass for a comparison that
    // silently found nothing at all.
    const observation = await compare(blank, inside, snapshotWith(undefined));

    expect(observation.verdict).toBe('changed');
    expect(observation.ignored).toBeUndefined();
  });

  it('attributes the absorbed pixels to the rule that absorbed them', async () => {
    const observation = await compare(blank, inside, snapshotWith(CLOCK_SITE));

    expect(observation.ignored?.byRule).toEqual({ clock: 64 });
  });
});

describe('a change outside the excluded subtree', () => {
  const outside = image({ x: 80, y: 80, size: 8 });
  const blank = image(null);

  it('is still reported, so the ignore did not blind the subject', async () => {
    const observation = await compare(blank, outside, snapshotWith(CLOCK_SITE));

    expect(observation.verdict).toBe('changed');
    expect(observation.isolation?.regions).toHaveLength(1);
  });

  it('names the ignore as having absorbed nothing', async () => {
    // The raster half of a dead rule. A box that covered no changed pixel this
    // run is either a fixed flake or a selector that has stopped matching, and
    // both are invisible without this count.
    const observation = await compare(blank, outside, snapshotWith(CLOCK_SITE));

    expect(observation.ignored).toEqual({ pixels: 0, boxes: 1, inert: 1, byRule: { clock: 0 } });
  });
});

describe('a change that straddles the boundary', () => {
  it('reports the half outside and absorbs the half inside', async () => {
    // The case a region-level filter gets wrong in both available directions.
    // Device (20,20)–(40,40) is excluded; this square runs from 32 to 48.
    const straddling = image({ x: 32, y: 32, size: 16 });
    const observation = await compare(image(null), straddling, snapshotWith(CLOCK_SITE));

    expect(observation.verdict).toBe('changed');
    expect(observation.ignored?.pixels).toBe(64);
    expect(observation.comparison?.changed['default']).toBe(256);
    expect(observation.because).toContain('absorbed by an ignore');
  });
});

describe('the scale conversion', () => {
  it('does not silence the top-left corner instead of the declared box', async () => {
    // At 1x the box would land at CSS (10,10) and cover the wrong 10×10. This
    // square sits where a 1x conversion would put the exclusion, and must be
    // reported.
    const corner = image({ x: 10, y: 10, size: 8 });
    const observation = await compare(image(null), corner, snapshotWith(CLOCK_SITE));

    expect(observation.verdict).toBe('changed');
    expect(observation.ignored?.pixels).toBe(0);
  });
});

describe('absorbing by shape rather than by place', () => {
  const blank = image(null);

  /** Fingerprint of a square painted at a given place, taken from a real run. */
  async function fingerprintOf(square: { x: number; y: number; size: number }): Promise<string> {
    const observation = await compare(blank, image(square), snapshotWith(undefined));
    return observation.regions[0]!.fingerprint!;
  }

  it('publishes a fingerprint on every region, so a rule can be written from a report', async () => {
    const observation = await compare(blank, image({ x: 80, y: 80, size: 8 }), snapshotWith(undefined));

    expect(observation.regions[0]?.fingerprint).toMatch(/^v1:/);
  });

  it('absorbs the same shape after it moves', async () => {
    // The property no rectangle has. A toast that reappears forty pixels lower is
    // the same artifact, and a coordinate ignore drawn where it was last seen
    // silences whatever lands there next instead.
    const print = await fingerprintOf({ x: 80, y: 80, size: 8 });

    const observation = await observePairWith(
      image({ x: 20, y: 100, size: 8 }),
      { [print]: 'toast' },
    );

    expect(observation.verdict).toBe('ignored');
    expect(observation.ignored?.byRule).toEqual({ toast: 64 });
  });

  it('does not absorb a different shape in the same place', async () => {
    // The whole argument for fingerprints. A regression that lands where a known
    // flake lands must still be reported.
    const print = await fingerprintOf({ x: 80, y: 80, size: 8 });

    const observation = await observePairWith(
      image({ x: 80, y: 80, size: 24 }),
      { [print]: 'toast' },
    );

    expect(observation.verdict).toBe('changed');
  });

  it('does not absorb the same shape an order of magnitude larger', async () => {
    // The digest is position-invariant by construction, and was *scale*-invariant
    // by accident: every solid block at or above the resampling grid produced one
    // bit pattern and one aspect, so a rule for a 12×12 flake absorbed a 96×96
    // card that had gone solid. Both sides are above the grid on purpose — the
    // pair this replaced was 8 against 24, and 8 is below it, so that test passed
    // by undersampling rather than for the reason it named.
    const print = await fingerprintOf({ x: 12, y: 12, size: 12 });

    const observation = await observePairWith(
      image({ x: 12, y: 12, size: 96 }),
      { [print]: 'toast' },
    );

    expect(observation.verdict).toBe('changed');
  });

  it('still absorbs the same shape at the same magnitude', async () => {
    // The control on the control. A size term tight enough to reject everything
    // would make shape ignores useless, so the same block moved and grown by a
    // pixel must still be the same shape.
    const print = await fingerprintOf({ x: 12, y: 12, size: 12 });

    const observation = await observePairWith(
      image({ x: 60, y: 40, size: 13 }),
      { [print]: 'toast' },
    );

    expect(observation.verdict).toBe('ignored');
  });

  async function observePairWith(
    after: string,
    ignoreShapes: Readonly<Record<string, string>>,
  ): ReturnType<typeof observePair> {
    return await observePair(documentFor('before'), documentFor('after'), {
      renderer: rendererFor(new Map([['before', blank], ['after', after]])),
      store: createEphemeralStore(),
      snapshot: snapshotWith(undefined),
      ignoreShapes,
    });
  }
});

/**
 * The ledger on the paths where nothing was compared.
 *
 * `new`, `incomparable` and a settlement from a digest all return before a
 * single pixel is subtracted, and every one of them still carries the operator's
 * exclusions. The run-level ledger reads a rule's absence as *this rule resolved
 * nowhere* and tells the operator to delete it, so a fresh checkout with no
 * baselines is exactly the run that would advise deleting every ignore in the
 * suite.
 */
describe('declaredIgnores', () => {
  it('keys a resolved rule at zero rather than leaving it out', () => {
    const ignored = declaredIgnores(snapshotWith(CLOCK_SITE), 1);

    // Present and zero, which is "it resolved and covered nothing changed".
    // Absent would be "it resolved nowhere", and that is advice to delete it.
    expect(ignored?.byRule).toEqual({ clock: 0 });
    expect(ignored?.pixels).toBe(0);
  });

  it('counts the boxes it excluded and calls none of them inert', () => {
    const ignored = declaredIgnores(snapshotWith(CLOCK_SITE), 2);

    expect(ignored?.boxes).toBe(1);
    // A box that was never compared covered no changed pixel because there were
    // no changed pixels — which is not the claim that the box is useless.
    expect(ignored?.inert).toBe(0);
  });

  it('reports nothing at all when the operator declared nothing', () => {
    // Not an empty ledger: a subject with no ignores and a subject whose ignores
    // all resolved to nothing are different facts, and only one of them is
    // something an operator should act on.
    expect(declaredIgnores(snapshotWith(undefined), 1)).toBeUndefined();
    expect(declaredIgnores(undefined, 1)).toBeUndefined();
  });
});
