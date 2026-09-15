import { afterAll, describe, expect, it } from 'vitest';
import {
  documentDigest,
  identityDigest,
  type Raster,
  type RenderDocument,
  type Viewport,
} from '@variance-authority/core/format';
import { compareRasters } from '@variance-authority/png';
import { DEFAULT_POLICY, type Renderer } from '@variance-authority/raster';
import { declaredEngines, installCommand, requireEngines } from './engines.js';
import { createPlaywrightRenderer } from './renderer.js';

/**
 * **Two engines paint one document, and the identity keeps them apart.**
 *
 * The category sells cross-browser coverage by multiplication: Percy prices "two
 * pages rendered across two browsers and three widths" as twelve screenshots, and
 * Chromatic bills `tests × builds × browsers × modes`. That arithmetic is honest
 * about their architecture — a browser produces the whole observation there, so a
 * second browser is a second run of everything.
 *
 * This file is the measurement of the other arrangement. One `RenderDocument` is
 * built once and handed to two engines; nothing is collected twice, no page is
 * navigated twice, and the *only* thing that runs a second time is the phase that
 * was always going to be engine-bound. Two paints of an existing document, not
 * two runs.
 *
 * And the second claim, which is the one that would be expensive if it were
 * false: **cross-engine safety needed no cross-engine code.** `RenderIdentity`
 * already carried the engine because it existed to keep two laptops apart, and
 * the store already keys on it. So a WebKit baseline cannot be found by a
 * Chromium run, cannot be silently compared against one, and the refusal names
 * both — by machinery nobody wrote for this.
 *
 * **What this does not prove.** That the stabilization recipe holds WebKit still.
 * Every trick in `RASTER_RECIPE` was written against Chromium's behaviour, and a
 * WebKit run that is stable here is one document on one machine, once.
 */

/**
 * The engines this run measures — **declared, and then required to exist.**
 *
 * This used to be `filter(existsSync)` over all three, so the result depended on
 * the machine: a laptop missing WebKit measured one engine and reported green,
 * which is the one outcome a visual-regression tool cannot produce. The list now
 * comes from `DECLARED_ENGINES` (or `VARIANCE_ENGINES`), and a declared engine
 * whose binary is absent throws during collection with its name and the install
 * command.
 *
 * Empty means this machine has *no* browser at all, which is CI on purpose, and
 * is the only condition under which this file may decline to run.
 */
const ENGINES = requireEngines(declaredEngines());

// Announced at module scope, because that is the only place a reader of a
// skipped run sees anything: vitest's default reporter never prints a skipped
// test's name, and CI runs the default reporter.
if (ENGINES.length === 0) {
  console.warn(
    `\npackages/playwright (engines): skipped, this machine has no browser.` +
      `\n  ${installCommand(declaredEngines())}\n`,
  );
}

const VIEWPORT: Viewport = {
  width: 400,
  height: 200,
  deviceScaleFactor: 1,
  colorScheme: 'light',
};

/**
 * A subject with text in it, because text is where engines disagree.
 *
 * Font rasterization and line breaking are the two things no two engines do
 * identically, which is the whole reason a baseline is engine-bound. A solid
 * rectangle would paint the same in both and make the test look like it proved
 * something it did not.
 */
function documentFor(): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id: 'engines/panel', kind: 'fixture' },
    html: '<div data-va-path="0" style="width:320px;padding:16px;font:16px/1.4 serif">Cross-engine subject with enough text to wrap onto a second line.</div>',
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

let renderers: Renderer[] = [];

afterAll(async () => {
  await Promise.all(renderers.map((renderer) => renderer.close()));
  renderers = [];
});

const gated = ENGINES.length > 0 ? describe : describe.skip;

gated('one document, every declared engine', () => {
  it('stamps each engine into the identity, so their baselines cannot collide', async () => {
    const opened = await Promise.all(
      ENGINES.map((browser) => createPlaywrightRenderer({ browser })),
    );
    renderers.push(...opened);

    for (const [index, browser] of ENGINES.entries()) {
      expect(opened[index]!.identity.renderer).toBe(`playwright-${browser}`);
      expect(opened[index]!.identity.engine.startsWith(`${browser}@`)).toBe(true);
    }

    // The load-bearing assertion, and it is about the store rather than the
    // image. A baseline is filed under `identityDigest`, so two engines agreeing
    // here would mean one overwriting the other's baseline and every later
    // comparison being between two engines with nothing saying so.
    const document = documentFor();
    const digests = new Set(opened.map((renderer) => identityDigest(renderer.identityFor(document))));
    expect(digests.size).toBe(ENGINES.length);
  }, 180_000);

  it('paints the same document in each, and the semantic half is not repeated', async () => {
    const document = documentFor();

    // One document. Acquired once, digested once, sent N times — which is the
    // whole cost argument against `tests × browsers`. What multiplies is the
    // ~65 ms paint; what does not multiply is the tier that decides.
    const digest = documentDigest(document);

    const opened = await Promise.all(
      ENGINES.map((browser) => createPlaywrightRenderer({ browser })),
    );
    renderers.push(...opened);

    const painted: Raster[] = await Promise.all(opened.map((renderer) => renderer.render(document)));

    for (const raster of painted) {
      // Each raster says which document it came from and which machine painted
      // it. The first is what makes a cross-engine run one collection; the second
      // is what keeps the images from ever being confused.
      expect(raster.documentDigest).toBe(digest);
      expect(raster.width).toBeGreaterThan(0);
      expect(raster.height).toBeGreaterThan(0);
    }

    expect(new Set(painted.map((raster) => identityDigest(raster.identity))).size).toBe(
      ENGINES.length,
    );
  }, 180_000);

  it('measures how far apart the engines actually are', async () => {
    // The empirical half of `incomparable`. Every product in this category
    // assumes a baseline is engine-bound, and this repository asserted it too —
    // from one engine. If two of these turned out byte-identical the refusal
    // would be ceremony, and the honest move would be to say so.
    //
    // What the numbers are worth: one document, one machine, one set of engine
    // builds, and a *lower* bound on divergence, because the subject is
    // deliberately small.
    const document = documentFor();

    // A one-engine declaration has no pair, so the loop below would assert
    // nothing and this would pass by not applying — the shape `tools/skips.check.ts`
    // exists to forbid. Stated here so narrowing the list fails instead.
    expect(ENGINES.length).toBeGreaterThan(1);

    const opened = await Promise.all(
      ENGINES.map((browser) => createPlaywrightRenderer({ browser })),
    );
    renderers.push(...opened);

    const painted = await Promise.all(opened.map((renderer) => renderer.render(document)));
    const lines: string[] = [];

    for (let left = 0; left < painted.length; left += 1) {
      for (let right = left + 1; right < painted.length; right += 1) {
        const comparison = await compareRasters(painted[left]!, painted[right]!);
        const changed = comparison.changed[DEFAULT_POLICY.id] ?? 0;

        lines.push(
          `  ${ENGINES[left]} vs ${ENGINES[right]}: ` +
            `${painted[left]!.width}×${painted[left]!.height} vs ` +
            `${painted[right]!.width}×${painted[right]!.height}, ` +
            (comparison.dimensionsChanged ? 'different dimensions' : 'same dimensions') +
            `, ${changed} differing pixel(s)`,
        );

        // Not an exact count: it is engine-build- and machine-specific, and
        // pinning it would make this red on every laptop for reasons that say
        // nothing about anybody's code. The direction is the claim.
        expect(comparison.dimensionsChanged || changed > 0).toBe(true);
      }
    }

    console.log(`\n--- one document, ${ENGINES.length} engines\n${lines.join('\n')}\n`);
  }, 180_000);
});
