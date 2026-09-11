/**
 * Pixels made by the browser the suite already pinned.
 *
 * The deferred path renders a document somewhere reproducible; this one asks the
 * page under test for its own screenshot, which is the only way to capture a
 * state a document cannot restate — and pays for it by having to declare the
 * launch that produced the pixels, because nothing else here can say which
 * machine, which flags, which scale.
 */

import type { Locator, Page } from '@playwright/test';
import { digestValue, documentDigest } from '@variance-authority/core/format';
import type { Raster, RenderIdentity, SemanticSnapshot } from '@variance-authority/core/format';
import { observeRasters } from '@variance-authority/observe';
import type { InPlaceCaptureOptions } from './options.js';

export async function stableRaster(
  page: Page,
  locator: Locator,
  document: Parameters<typeof documentDigest>[0],
  fonts: readonly string[],
  stabilization: RenderIdentity['stabilization'],
  options: InPlaceCaptureOptions,
  snapshot: SemanticSnapshot,
): Promise<Raster> {
  const screenshot = {
    type: 'png',
    // Acquisition leaves the declared CSS animation hold installed. Let that
    // one owner define both semantic and pixel state; asking Playwright to
    // fast-forward here would apply a conflicting second intervention.
    animations: 'allow',
    caret: 'hide',
  } as const;
  const browser = page.context().browser();
  const engine = browser?.browserType().name() ?? 'browser';
  const identity: RenderIdentity = {
    renderer: `playwright-${engine}-existing-page`,
    engine: `${engine}@${browser?.version() ?? 'unknown'}`,
    platform: `${process.platform}/${process.arch}`,
    deviceScaleFactor: document.viewport.deviceScaleFactor,
    fonts,
    ...(stabilization === undefined ? {} : { stabilization }),
    rasterization: digestValue({
      browser: {
        headless: options.browser.headless,
        launchArgs: [...options.browser.launchArgs],
      },
      screenshot,
    }),
  };
  const count = Math.max(2, options.stabilityChecks ?? 2);
  const rasters: Raster[] = [];

  for (let index = 0; index < count; index += 1) {
    const bytes = await locator.screenshot(screenshot);
    const box = await locator.boundingBox();
    if (box === null) throw new Error(`subject ${document.subject.id} has no screenshot box`);
    rasters.push({
      documentDigest: documentDigest(document),
      identity,
      width: Math.round(box.width * document.viewport.deviceScaleFactor),
      height: Math.round(box.height * document.viewport.deviceScaleFactor),
      bytes: bytes.toString('base64'),
      missingFonts: [],
    });
  }

  const first = rasters[0]!;
  for (const next of rasters.slice(1)) {
    const agreement = await observeRasters(document.subject.id, first, next, { snapshot });
    if (agreement.verdict !== 'unchanged') {
      throw new Error(
        `in-place capture for ${document.subject.id} is unstable: repeated screenshots disagree`,
      );
    }
  }
  return first;
}
