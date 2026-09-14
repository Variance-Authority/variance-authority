import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Page,
} from 'playwright';
import {
  RASTER_RECIPE,
  conflicts,
  digestValue,
  documentDigest,
  recipeCss,
  recipeDigest,
  recipeScreenshot,
  settleRecipe,
  type Raster,
  type Recipe,
  type RenderDocument,
  type RenderIdentity,
  type Viewport,
} from '@variance-authority/core/format';
import { captureSubject } from './capture.js';
import {
  assertClosedResources,
  refuseMissingResources,
  serveClosedResources,
} from './resources.js';
import {
  assemble,
  familiesOf,
  identityAtScale,
  type AssembleOptions,
  type Renderer,
} from '@variance-authority/raster';

/**
 * A local renderer: one browser, one page per viewport, N documents.
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

/**
 * The engines this renderer can be. Defaults to `chromium`.
 *
 * ## Why cross-browser is a field here and a plan tier everywhere else
 *
 * The category prices coverage by multiplication — Percy states it as "two pages
 * rendered across two browsers and three widths would result in twelve
 * screenshots", and Chromatic bills `tests × builds × browsers × modes`. That
 * arithmetic is a property of pipelines where a browser produces the *whole*
 * observation, so observing in a second engine means running everything again.
 *
 * Here a `RenderDocument` is acquired once, by one collector, and rasterization
 * is the only phase that is engine-bound. So a second engine costs one more
 * paint of a document that already exists — not a second run. The multiplication
 * is against the tier that is ~65 ms rather than against the tier that decides.
 *
 * ## Why this needs no new comparison rule
 *
 * The engine is already in {@link RenderIdentity}, which already keys the store
 * and already decides comparability. A WebKit baseline therefore lands in its own
 * directory, and a Chromium run that finds it reports `incomparable` and names
 * both engines — by the machinery that was there for two laptops, unchanged.
 * Nothing about cross-engine support required a cross-engine concept.
 *
 * **What is not claimed.** The tricks in the stabilization recipe are written
 * against Chromium's behaviour and have never been asked to hold another engine
 * still, and text rasterization is pinnable on Chromium alone — see
 * {@link CHROMIUM_RASTER_ARGS}. `engines.chromium.test.ts` exercises whichever
 * engines are installed, so the identity claim is verified rather than assumed.
 */
export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';

const ENGINES: Readonly<Record<BrowserEngine, BrowserType>> = { chromium, firefox, webkit };

/**
 * Chromium settings that make text rasterization independent of host defaults.
 *
 * **No other engine accepts them**, so Firefox and WebKit paint text the way the
 * host does; WebKit's one lever is the page's `-webkit-font-smoothing`, which
 * changes the subject rather than the conditions it is shot under. Dormant on
 * macOS — no subpixel antialiasing since 10.14, every flag a no-op — and
 * load-bearing wherever fontconfig is live: 6,662 chromatic pixels in the standard
 * image, zero with the flags. A raster belongs to a host. See the README.
 */
export const CHROMIUM_RASTER_ARGS = [
  '--disable-lcd-text',
  '--font-render-hinting=none',
] as const;

export interface PlaywrightRendererOptions {
  readonly headless?: boolean;

  /**
   * Browser launch arguments that may affect pixels.
   *
   * Chromium defaults to {@link CHROMIUM_RASTER_ARGS}; other engines default to
   * none. The exact ordered list is folded into `RenderIdentity`.
   */
  readonly launchArgs?: readonly string[];

  /** Which engine paints. Defaults to `chromium`. See {@link BrowserEngine}. */
  readonly browser?: BrowserEngine;

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
   * Which tricks hold the page still. Defaults to the raster recipe.
   *
   * A list rather than a set of switches, so a project can drop one, replace one
   * with a different mechanism, or add its own without editing this package.
   * Every shipped trick is applied from outside the subject, so nothing in the
   * product is shaped by it. The recipe is folded into the renderer's identity:
   * a baseline made under one recipe and a run made under another are
   * `incomparable`, not `changed`, because what differs is this option rather
   * than anybody's code.
   */
  readonly stabilization?: Recipe;

  /**
   * How many documents may be painted at once. Defaults to 1.
   *
   * Above 1 this renderer leases a *separate page* per render instead of sharing
   * one per viewport, because `setContent` replaces a page's whole document —
   * two concurrent renders into one page would paint each other's subject, which
   * is the failure the harness has always warned about, arriving from the other
   * direction.
   *
   * Pages, not browsers. A page costs a few MB against a browser's process, and
   * the isolation a *render* needs is a document of its own: nothing here shares
   * state between renders, since each one `setContent`s a complete document.
   * That is exactly the property collection does **not** have (ADR-0009), which
   * is why the collector stays serial while this does not.
   *
   * Worth having because the raster tier is where a run's time is: ~65 ms to
   * paint against ~7.5 ms to collect.
   */
  readonly concurrency?: number;
}

export async function createPlaywrightRenderer(
  options: PlaywrightRendererOptions = {},
): Promise<Renderer> {
  const engine = options.browser ?? 'chromium';
  const headless = options.headless ?? true;
  const launchArgs = options.launchArgs ?? (engine === 'chromium' ? CHROMIUM_RASTER_ARGS : []);
  const browser = await ENGINES[engine].launch({ headless, args: [...launchArgs] });
  const recipe = options.stabilization ?? RASTER_RECIPE;
  const holdStill = recipeCss(recipe);
  const shot = recipeScreenshot(recipe);
  // Two objects, because two identity fields ask different questions. `raster`
  // is what this renderer decided; `screenshot` is that plus whatever the recipe
  // asked the driver for.
  const raster = { type: 'png' } as const;
  const screenshot = { ...raster, ...shot } as const;

  // Refused rather than resolved. Two tricks over one property means one wins by
  // accident of ordering, and which one is invisible in every image that follows.
  const clashes = conflicts(recipe);
  if (clashes.length > 0) {
    await browser.close();
    throw new Error(
      'stabilization recipe has tricks claiming the same property: ' +
        clashes.map((clash) => `${clash.governs} (${clash.ids.join(', ')})`).join('; '),
    );
  }

  try {
    const identity: RenderIdentity = {
      renderer: `playwright-${engine}`,
      engine: `${engine}@${browser.version()}`,
      platform: `${process.platform}/${process.arch}`,
      // The scale belongs to the document, not to the browser — one renderer
      // serves 1x and 2x viewports in the same run. Left at 1 so the machine
      // identity is a complete, readable value; `identityFor` supplies the real
      // one, and nothing may key a store on this.
      deviceScaleFactor: 1,
      fonts: options.fonts ?? [],
      stabilization: recipeDigest(recipe),
      // The recipe's screenshot options are deliberately not in here.
      // `stabilization` already names the recipe, and it names it by which
      // tricks are present rather than by how each one is spelled — so a trick
      // that moves from a driver option to a stylesheet is the same recipe and
      // keeps the same digest. Folding `shot` in as well made `rasterization`
      // disagree: `hideCaret` moved from `screenshot: { caret: 'hide' }` to a
      // `caret-color` hold in 0.2.0, the images came out byte-identical, and
      // every baseline in the world went `incomparable` over a spelling.
      //
      // What belongs here is what the machine does to the pixels no recipe
      // asked for: which browser, launched how, photographed into what format.
      rasterization: digestValue({
        browser: { headless, launchArgs: [...launchArgs] },
        screenshot: raster,
      }),
    };

    const concurrency = Math.max(1, options.concurrency ?? 1);
    const activeResources = new WeakMap<BrowserContext, Set<string>>();
    const pool = new PagePool(browser, concurrency, (context, url) => {
      activeResources.get(context)?.add(`websocket ${url}`);
    });

    // One expression, used by `render` to stamp the raster and by the pipeline
    // to look a baseline up. Two expressions is how the write key and the lookup
    // key drifted apart, and a drift of one field is invisible at 1x.
    const identityFor = (document: RenderDocument): RenderIdentity =>
      identityAtScale(identity, document);

    return {
      identity,
      identityFor,

      async render(document: RenderDocument): Promise<Raster> {
        assertClosedResources(document);
        const closed = document.resources !== undefined;
        const lease = await pool.acquire(document.viewport, closed);
        const page = lease.page;
        const context = page.context();

        try {
          const missingResources = new Set<string>();
          await context.unrouteAll({ behavior: 'wait' });
          if (closed) {
            activeResources.set(context, missingResources);
            await serveClosedResources(context, document, missingResources);
          }

          await page.setContent(assemble(document, options.assemble ?? {}), {
            waitUntil: options.waitForFonts === false ? 'domcontentloaded' : 'load',
          });

          refuseMissingResources(document, missingResources);

          // After `setContent`, because `setContent` replaces the document and
          // would discard a sheet added before it.
          if (holdStill !== '') await page.addStyleTag({ content: holdStill });

          // Every wait the recipe asks for, and nothing else. A recipe with no
          // waits — the structure-and-style rung — pays for none of this.
          if (options.waitForFonts !== false) await settleRecipe(recipe, page);

          const missingFonts = await page.evaluate(probeFonts, familiesOf(document.fonts));

          // Takes the element path or a page clip over the same rectangle,
          // whichever is cheaper and identical; `capture.ts` owns that decision
          // and the animation options both paths are given.
          const { bytes, box } = await captureSubject(page, document.viewport, screenshot);

          // Catch work queued by load/font completion or the screenshot itself.
          // Every network channel remains blocked for the whole lease; this turn
          // gives queued callbacks one browser frame in which to declare a miss.
          await page.evaluate(
            () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
          );
          refuseMissingResources(document, missingResources);

          // A subject with no box — or a box with a zero side — is recorded
          // rather than refused. It rendered nothing: its only child went to a
          // portal, it was mounted with no children, or the styling that gave it
          // a size was not in the capture. Every one of those is a real state of
          // a real subject, and the capture still holds its document, its rules,
          // its component hashes and its accessibility tree, all of which
          // compare. Refusing the subject over the one axis nobody was asking
          // about reported a quarter of Material UI's unit tier as unobserved.
          //
          // The three image fields are absent together, and that absence is the
          // record: *occupies no pixels*, never *the image was lost*.
          const pixels =
            box === null || bytes === null
              ? {}
              : {
                  // Device pixels, which is what the mask and the regions are in.
                  // The conversion back to CSS pixels happens once, in
                  // `attributeRegions`, where the caller has to name the scale.
                  width: Math.round(box.width * document.viewport.deviceScaleFactor),
                  height: Math.round(box.height * document.viewport.deviceScaleFactor),
                  bytes: bytes.toString('base64'),
                };

          return {
            documentDigest: documentDigest(document),
            identity: identityFor(document),
            ...pixels,
            missingFonts,
          };
        } finally {
          activeResources.delete(context);
          await Promise.all(
            context.pages().filter((candidate) => candidate !== page).map((candidate) => candidate.close()),
          );
          // Released on the failure path too. A render that throws while holding
          // the only page of a pool of one deadlocks every subject after it.
          lease.release();
        }
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
class PagePool {
  readonly #browser: Browser;
  readonly #limit: number;
  readonly #onWebSocket: (context: BrowserContext, url: string) => void;
  /** Idle pages, per viewport key. A render takes one and puts it back. */
  readonly #idle = new Map<string, Page[]>();
  #leased = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(
    browser: Browser,
    limit: number,
    onWebSocket: (context: BrowserContext, url: string) => void,
  ) {
    this.#browser = browser;
    this.#limit = limit;
    this.#onWebSocket = onWebSocket;
  }

  /**
   * Wait for a slot, then hand back a page nobody else is painting into.
   *
   * The slot count is global while pages are keyed by viewport, and those are
   * deliberately different. The limit exists to bound *concurrent Chromium work*,
   * which does not care what size the pages are; the key exists because a page's
   * viewport and scale factor cannot be changed without recreating its context.
   * A run at one viewport — the normal case — reuses the same pages forever.
   */
  async acquire(viewport: Viewport, closed: boolean): Promise<{ page: Page; release: () => void }> {
    while (this.#leased >= this.#limit) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
    this.#leased += 1;

    const key = `${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor}/${viewport.colorScheme}/${closed ? 'closed' : 'open'}`;

    try {
      const free = this.#idle.get(key) ?? [];
      const page = free.pop() ?? (await this.#open(viewport, closed));
      this.#idle.set(key, free);

      let released = false;
      return {
        page,
        release: () => {
          // Guarded because a double release would let two renders hold the same
          // page, which is the one thing this class exists to prevent.
          if (released) return;
          released = true;
          (this.#idle.get(key) ?? []).push(page);
          this.#leased -= 1;
          this.#waiting.shift()?.();
        },
      };
    } catch (error) {
      this.#leased -= 1;
      this.#waiting.shift()?.();
      throw error;
    }
  }

  async #open(viewport: Viewport, closed: boolean): Promise<Page> {
    // Not tracked for teardown: `close()` closes the browser, which takes every
    // context with it. A second list to keep in step would only drift.
    const context = await this.#browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      colorScheme: viewport.colorScheme,
      serviceWorkers: closed ? 'block' : 'allow',
    });
    const page = await context.newPage();
    if (closed) {
      await context.routeWebSocket(/.*/, async (route) => {
        this.#onWebSocket(context, route.url());
        await route.close({ code: 1008, reason: 'resource-closed render' });
      });
      // A page that has never committed a navigation is not covered by WebSocket
      // interception, and `setContent` alone does not commit one — it replaces the
      // document of the page the browser opened at. Without this the socket policy
      // is silently absent and a resource-closed document dials out unrefused.
      // `about:blank` because it is where the page already is: the URL, and so the
      // resolution context for a document carrying no `<base>`, is left unchanged.
      await page.goto('about:blank');
    }
    return page;
  }
}

