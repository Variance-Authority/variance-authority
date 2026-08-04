import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { documentDigest, type RenderDocument } from '@variance-authority/core';
import { comparePngs, decode } from '@variance-authority/png';
import { createPlaywrightRenderer } from './renderer.js';

/**
 * What the page pool has to be true for.
 *
 * `render` used to hold one page per viewport and reuse it. That is correct while
 * renders are sequential and catastrophic the moment they are not: `setContent`
 * replaces a page's entire document, so two concurrent renders sharing a page
 * paint each other's subject and each returns an image of the wrong one. Both
 * runs look successful. The verdicts are simply about the wrong components.
 *
 * So these tests are about *isolation under concurrency*, not about speed. A
 * timing assertion here would be flaky on a loaded machine and would not catch
 * the failure that matters.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const VIEWPORT = { width: 200, height: 120, deviceScaleFactor: 1, colorScheme: 'light' } as const;

function documentOf(id: string, colour: string): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id, kind: 'fixture' },
    html: `<div data-va-path="0" style="width:160px;height:80px;background:${colour}">${id}</div>`,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

describe.skipIf(!BROWSER_AVAILABLE)('createPlaywrightRenderer — concurrency', () => {
  it('paints each document into its own page when several render at once', async () => {
    // The whole point. Six distinct colours rendered concurrently through a pool
    // of four: if any two shared a page, at least one image would carry another
    // subject's colour, and the digests would disagree with the sequential run.
    const renderer = await createPlaywrightRenderer({ concurrency: 4, waitForFonts: false });

    try {
      const colours = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
      const documents = colours.map((colour, index) => documentOf(`fixture:${index}`, colour));

      const concurrent = await Promise.all(documents.map((document) => renderer.render(document)));

      // Rendered one at a time, which is what the old code did and is the
      // reference answer. Same renderer, so nothing else varies.
      for (const [index, document] of documents.entries()) {
        const alone = await renderer.render(document);
        const comparison = comparePngs(decode(concurrent[index]!.bytes), decode(alone.bytes));

        expect(
          comparison.changed['default'],
          `subject ${index} differs when rendered concurrently`,
        ).toBe(0);
      }
    } finally {
      await renderer.close();
    }
  }, 60_000);

  it('stamps every raster with its own document digest', async () => {
    // The cheaper half of the same guarantee, and the one that would survive a
    // pool bug that swapped two same-sized images: a raster carries the digest of
    // the document it was asked to paint, so a mix-up is visible without pixels.
    const renderer = await createPlaywrightRenderer({ concurrency: 3, waitForFonts: false });

    try {
      const documents = ['#111111', '#222222', '#333333', '#444444'].map((colour, index) =>
        documentOf(`fixture:${index}`, colour),
      );
      const rasters = await Promise.all(documents.map((document) => renderer.render(document)));

      expect(rasters.map((raster) => raster.documentDigest)).toEqual(
        documents.map((document) => documentDigest(document)),
      );
    } finally {
      await renderer.close();
    }
  }, 60_000);

  it('returns a page to the pool when a render throws, rather than deadlocking', async () => {
    // A pool of one, and the first render fails. Without a release on the failure
    // path the second call waits for a slot that is never coming, and the run
    // hangs with no error — the worst possible failure for a CI job.
    const renderer = await createPlaywrightRenderer({ concurrency: 1, waitForFonts: false });

    try {
      const broken: RenderDocument = {
        ...documentOf('fixture:broken', '#000'),
        // Zero-sized rather than absent, though both take Playwright's 30s
        // actionability timeout to fail — it waits for the element to become
        // shootable either way. That half minute is the price of this assertion
        // and it is worth paying: without a release on the failure path a pool
        // of one deadlocks, and a CI job that hangs with no error is a worse
        // outcome than any test being slow.
        html: '<div data-va-path="0" style="width:0;height:0"></div>',
      };

      await expect(renderer.render(broken)).rejects.toThrow();

      const raster = await renderer.render(documentOf('fixture:after', '#abcdef'));
      expect(raster.width).toBeGreaterThan(0);
    } finally {
      await renderer.close();
    }
  }, 60_000);
});

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\n@variance-authority/playwright (renderer pool): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}
