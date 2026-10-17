import type { Browser, BrowserContext, Page } from 'playwright';
import type { PageRegion, Viewport } from '@variance-authority/core/format';

/**
 * One page per viewport, reused.
 *
 * `deviceScaleFactor` and `colorScheme` are context-level in Playwright, so a
 * document at 2x genuinely needs its own context. Keying the cache on the whole
 * viewport rather than recreating per render keeps a run at one context in the
 * normal case, where every subject shares a viewport.
 */
export class PagePool {
  readonly #browser: Browser;
  readonly #limit: number;
  readonly #region: Required<PageRegion>;
  readonly #onWebSocket: (context: BrowserContext, url: string) => void;
  /** The recipe's driver tricks, applied to each page as it opens. */
  readonly #drive: (page: Page) => Promise<void>;
  /** Idle pages, per viewport key. A render takes one and puts it back. */
  readonly #idle = new Map<string, Page[]>();
  /** Every context this pool opened, for {@link close}. */
  readonly #contexts: BrowserContext[] = [];
  #leased = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(
    browser: Browser,
    limit: number,
    region: Required<PageRegion>,
    onWebSocket: (context: BrowserContext, url: string) => void,
    drive: (page: Page) => Promise<void>,
  ) {
    this.#browser = browser;
    this.#limit = limit;
    this.#region = region;
    this.#onWebSocket = onWebSocket;
    this.#drive = drive;
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
    const context = await this.#browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      colorScheme: viewport.colorScheme,
      ...this.#region,
      serviceWorkers: closed ? 'block' : 'allow',
    });
    this.#contexts.push(context);
    const page = await context.newPage();
    await this.#drive(page);
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

  /**
   * Close every context this pool opened.
   *
   * The browser is leased and may outlive this pool — a collector's pages are
   * still in it — so what the pool opened is closed here rather than by closing
   * the browser.
   */
  async close(): Promise<void> {
    await Promise.all(this.#contexts.splice(0).map(async (context) => context.close()));
  }
}
