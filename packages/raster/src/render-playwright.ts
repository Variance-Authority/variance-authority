import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  documentDigest,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
  type Viewport,
} from '@variance-authority/core';
import { assemble, SUBJECT_PATH, type AssembleOptions } from './assemble.js';
import {
  RASTER_STABILIZATION,
  stabilizationCss,
  stabilizationDigest,
  type Stabilization,
} from './stabilize.js';
import { familiesOf, identityAtScale, type Renderer } from './renderer.js';

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

  /**
   * What to do to the page so it holds still. Defaults to the raster set.
   *
   * Every entry is an intervention applied from outside the subject, so nothing
   * in the product is shaped by it. The applied set is folded into the
   * renderer's identity: a baseline stabilised one way and a run stabilised
   * another are `incomparable`, not `changed`, because the difference between
   * them is this option rather than anybody's code.
   */
  readonly stabilization?: Stabilization;
}

export async function createPlaywrightRenderer(
  options: PlaywrightRendererOptions = {},
): Promise<Renderer> {
  const browser = await chromium.launch({ headless: options.headless ?? true });
  const stabilization = options.stabilization ?? RASTER_STABILIZATION;
  const holdStill = stabilizationCss(stabilization);

  try {
    const identity: RenderIdentity = {
      renderer: `playwright-chromium`,
      engine: `chromium@${browser.version()}`,
      platform: `${process.platform}/${process.arch}`,
      // The scale belongs to the document, not to the browser — one renderer
      // serves 1x and 2x viewports in the same run. Left at 1 so the machine
      // identity is a complete, readable value; `identityFor` supplies the real
      // one, and nothing may key a store on this.
      deviceScaleFactor: 1,
      fonts: options.fonts ?? [],
      stabilization: stabilizationDigest(stabilization),
    };

    const pages = new Map<string, Page>();
    const contexts: BrowserContext[] = [];

    // One expression, used by `render` to stamp the raster and by the pipeline
    // to look a baseline up. Two expressions is how the write key and the lookup
    // key drifted apart, and a drift of one field is invisible at 1x.
    const identityFor = (document: RenderDocument): RenderIdentity =>
      identityAtScale(identity, document);

    return {
      identity,
      identityFor,

      async render(document: RenderDocument): Promise<Raster> {
        const page = await pageFor(browser, pages, contexts, document.viewport);

        await page.setContent(assemble(document, options.assemble ?? {}), {
          waitUntil:
            options.waitForFonts === false || !stabilization.fonts ? 'domcontentloaded' : 'load',
        });

        // After `setContent`, because `setContent` replaces the document and
        // would discard a sheet added before it.
        if (holdStill !== '') await page.addStyleTag({ content: holdStill });

        if (options.waitForFonts !== false && stabilization.fonts) {
          await page.evaluate(() => window.document.fonts.ready);
        }

        if (stabilization.images) {
          // Decoding, not merely fetched: an image that has arrived but not
          // decoded still lays out at its intrinsic size and paints as nothing.
          await page.evaluate(() =>
            Promise.all(
              Array.from(window.document.images)
                .filter((image) => !image.complete)
                .map(
                  (image) =>
                    new Promise<void>((resolve) => {
                      image.addEventListener('load', () => resolve(), { once: true });
                      image.addEventListener('error', () => resolve(), { once: true });
                    }),
                ),
            ).then(() => undefined),
          );
        }

        const missingFonts = await page.evaluate(probeFonts, familiesOf(document.fonts));

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
          identity: identityFor(document),
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
 * Which of these families the renderer does not actually have.
 *
 * `document.fonts.check` was the obvious mechanism and it is the wrong one. It
 * answers "are the fonts needed to render this text loaded", which for a family
 * that is not declared in any `@font-face` is trivially yes — the browser will
 * fall back and paint something. It returned `true` for a family invented on the
 * spot, so a substitution check built on it reports nothing, always.
 *
 * Metrics are the only honest signal available inside a page. A family that
 * resolves changes the measured width of a string away from the generic it would
 * otherwise fall back to; a family that does not resolve measures identically to
 * the generic, on all three of them. Three generics rather than one because a
 * real font can coincidentally match one of them in width.
 *
 * Runs in the page, so it is written as a standalone function with no closure
 * over anything in this module.
 *
 * **Limit.** A font that is genuinely metric-compatible with a generic — the
 * point of Arimo, Liberation Sans, and the metric-compatible substitutes a Linux
 * container ships precisely so that layout does not move — reads as missing here.
 * That is a false alarm, and it errs toward reporting a doubt rather than
 * swallowing one. The reliable answer needs the font *bytes*, which is why the
 * environment key takes font identities as caller-supplied content hashes
 * (spec §11.1) rather than trusting anything a page can observe.
 */
function probeFonts(families: readonly string[]): string[] {
  const canvas = window.document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (context === null) return [];

  const GENERICS = ['monospace', 'sans-serif', 'serif'];
  const SAMPLE = 'mmmmmmmmmmlliWWWWQ@#0123456789';

  const widthOf = (stack: string): number => {
    context.font = `72px ${stack}`;
    return context.measureText(SAMPLE).width;
  };

  return families.filter((family) =>
    GENERICS.every((generic) => widthOf(`"${family}",${generic}`) === widthOf(generic)),
  );
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
