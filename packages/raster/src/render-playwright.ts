import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  documentDigest,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
  type Viewport,
} from '@variance-authority/core';
import { assemble, SUBJECT_PATH, type AssembleOptions } from './assemble.js';
import { familiesOf, type Renderer } from './renderer.js';

/**
 * A local Chromium renderer: one browser, one page per viewport, N documents.
 *
 * Persistent for the reason measured in journal 0007 — a browser launch and first
 * navigation dominate the work they enclose by roughly two orders of magnitude
 * (205 ms cold against 7.5 ms warm), so a renderer that launches per image spends
 * the entire saving this project exists to produce before it paints anything.
 *
 * `setContent` rather than `goto`: the document is the input, and there is no
 * server, no build, and no application to navigate to. That is also what makes
 * this renderer able to serve documents acquired from jsdom, which has no browser
 * to navigate at all.
 */

export interface PlaywrightRendererOptions {
  readonly headless?: boolean;

  /**
   * Fonts this machine is asserted to have, as `family/weight/style/hash`.
   *
   * Asserted, not detected: a page can ask whether a family resolves, and cannot
   * read the bytes behind it. This is the caller's declaration of what the
   * machine is, and it goes straight into the identity digest — which is the
   * mechanism by which a durable baseline written on a machine with a different
   * font stack is reported incomparable instead of compared.
   */
  readonly fonts?: readonly string[];

  readonly assemble?: AssembleOptions;

  /** Waits for web fonts and images before shooting. Defaults to `true`. */
  readonly waitForFonts?: boolean;
}

export async function createPlaywrightRenderer(
  options: PlaywrightRendererOptions = {},
): Promise<Renderer> {
  const browser = await chromium.launch({ headless: options.headless ?? true });

  try {
    const identity: RenderIdentity = {
      renderer: `playwright-chromium`,
      engine: `chromium@${browser.version()}`,
      platform: `${process.platform}/${process.arch}`,
      // Filled per document below. Left at 1 here so the identity is complete
      // and readable; documents at a different scale get their own identity.
      deviceScaleFactor: 1,
      fonts: options.fonts ?? [],
    };

    const pages = new Map<string, Page>();
    const contexts: BrowserContext[] = [];

    return {
      identity,

      async render(document: RenderDocument): Promise<Raster> {
        const page = await pageFor(browser, pages, contexts, document.viewport);

        await page.setContent(assemble(document, options.assemble ?? {}), {
          waitUntil: options.waitForFonts === false ? 'domcontentloaded' : 'load',
        });

        if (options.waitForFonts !== false) {
          await page.evaluate(() => window.document.fonts.ready);
        }

        const missingFonts = await page.evaluate((families: readonly string[]) => {
          return families.filter((family) => !window.document.fonts.check(`16px "${family}"`));
        }, familiesOf(document.fonts));

        const subject = page.locator(`[data-va-path="${SUBJECT_PATH}"]`);
        const bytes = await subject.screenshot({ type: 'png' });
        const box = await subject.boundingBox();

        if (box === null) {
          throw new Error(
            `subject root has no box in the rendered document (${document.subject.id}); ` +
              'the document assembled to something that lays out to nothing',
          );
        }

        return {
          documentDigest: documentDigest(document),
          identity: {
            ...identity,
            deviceScaleFactor: document.viewport.deviceScaleFactor,
          },
          // Device pixels, which is what the mask and the regions are in. The
          // conversion back to CSS pixels happens once, in `attributeRegions`,
          // where the caller has to name the scale.
          width: Math.round(box.width * document.viewport.deviceScaleFactor),
          height: Math.round(box.height * document.viewport.deviceScaleFactor),
          bytes: bytes.toString('base64'),
          missingFonts,
        };
      },

      async close(): Promise<void> {
        await browser.close();
      },
    };
  } catch (error) {
    // The browser is a child process; throwing between launch and return would
    // otherwise leave it running for the life of the caller.
    await browser.close();
    throw error;
  }
}

/**
 * One page per viewport, reused.
 *
 * `deviceScaleFactor` and `colorScheme` are context-level in Playwright, so a
 * document at 2x genuinely needs its own context. Keying the cache on the whole
 * viewport rather than recreating per render keeps a run at one context in the
 * normal case, where every subject shares a viewport.
 */
async function pageFor(
  browser: Browser,
  pages: Map<string, Page>,
  contexts: BrowserContext[],
  viewport: Viewport,
): Promise<Page> {
  const key = `${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor}/${viewport.colorScheme}`;
  const existing = pages.get(key);
  if (existing !== undefined) return existing;

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    colorScheme: viewport.colorScheme,
  });
  contexts.push(context);

  const page = await context.newPage();
  pages.set(key, page);
  return page;
}
