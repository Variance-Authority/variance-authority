import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright';
import { ENGINE_TYPES, type BrowserEngine } from './engines.js';

/**
 * One browser per process, held for as long as anything in it is using one.
 *
 * A run opens a collector world, a world per worker and a renderer, and each of
 * them used to launch a Chromium of its own: four launches for a run of three
 * workers, and four processes that share no cache. The process is the expensive
 * part — `docs/better-tests.md` measures a capture that launches a browser first
 * at about 205 ms against about 7.5 ms into an open page, some 27 captures — and
 * nothing a world or a renderer does needs a process to itself: each one owns
 * its pages and its contexts, and a browser only hosts them.
 *
 * So a browser is leased, not launched. The first lease launches it, every
 * later lease with the same launch options gets the same one, and the last
 * release closes it: whoever started it is whoever stops it, and that is the
 * lease count reaching zero. Launch options that differ get a browser of their
 * own, because a headed window or a different text setting paints different
 * pixels and must never be borrowed by a caller that asked for the other.
 *
 * A browser that dies is forgotten at once, so the next lease launches a new
 * one rather than handing out a corpse.
 */

/** A shared value and the one way to give it back. */
export interface Lease<T> {
  readonly value: T;

  /** Give the value back. The last release closes it; a second call does nothing. */
  release(): Promise<void>;
}

/** How a browser is launched, and therefore which leases may share it. */
export interface Launch {
  readonly headless: boolean;
  readonly args: readonly string[];
}

/** Values opened once per key and closed when the last holder lets go. */
class Shelf<T> {
  readonly #entries = new Map<string, { readonly opening: Promise<T>; holders: number }>();
  readonly #close: (value: T) => Promise<void>;

  constructor(close: (value: T) => Promise<void>) {
    this.#close = close;
  }

  async lease(key: string, open: () => Promise<T>): Promise<Lease<T>> {
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      const opening = open();
      const created = { opening, holders: 0 };
      entry = created;
      this.#entries.set(key, created);
      // A failed open is not kept: the next lease tries again rather than
      // inheriting this one's error for the rest of the process.
      opening.catch(() => this.#forget(key, created));
    }
    const held = entry;
    held.holders += 1;

    let value: T;
    try {
      value = await held.opening;
    } catch (error) {
      held.holders -= 1;
      throw error;
    }

    let released = false;
    return {
      value,
      release: async (): Promise<void> => {
        if (released) return;
        released = true;
        held.holders -= 1;
        if (held.holders > 0) return;
        // Off the shelf before it closes, so a lease taken while it is closing
        // opens a new one instead of being handed the one on its way out.
        const current = this.#entries.get(key) === held;
        this.#forget(key, held);
        if (current) await this.#close(value);
      },
    };
  }

  /** Drop the value under `key` when it is `value`, without closing it. */
  forgetValue(key: string, value: T): void {
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    entry.opening.then(
      (opened) => {
        if (opened === value) this.#forget(key, entry);
      },
      () => {},
    );
  }

  #forget(key: string, entry: { readonly opening: Promise<T> }): void {
    if (this.#entries.get(key) === entry) this.#entries.delete(key);
  }
}

const browsers = new Shelf<Browser>(async (browser) => browser.close());

/**
 * The process's browser for this engine and these launch options, launched if
 * nothing holds one.
 */
export async function leaseBrowser(engine: BrowserEngine, launch: Launch): Promise<Lease<Browser>> {
  const key = JSON.stringify([engine, launch.headless, launch.args]);
  return browsers.lease(key, async () => {
    const browser = await ENGINE_TYPES[engine].launch({ headless: launch.headless, args: [...launch.args] });
    browser.on('disconnected', () => browsers.forgetValue(key, browser));
    return browser;
  });
}

/**
 * A browser nobody else will be handed, closed by its release.
 *
 * For the reading that exists to rule the shared one out: `collectAlone` asks
 * whether a subject differs because something else ran first, and a browser
 * another world has used is something else.
 */
export async function ownBrowser(engine: BrowserEngine, launch: Launch): Promise<Lease<Browser>> {
  const browser = await ENGINE_TYPES[engine].launch({ headless: launch.headless, args: [...launch.args] });
  return owned(browser, async () => browser.close());
}

const contexts = new WeakMap<Browser, Shelf<BrowserContext>>();

/**
 * The browser's context for these options, shared by every page opened with them.
 *
 * The context is where a browser keeps its HTTP cache, and an incognito context
 * starts empty: a page in a context of its own fetches and compiles everything
 * again. Pages that share one are answered by the first page's fetches. They
 * also share its cookies and storage, which is the price, and is why a caller
 * asks for this rather than getting it.
 */
export async function leaseContext(browser: Browser, options: BrowserContextOptions): Promise<Lease<BrowserContext>> {
  let shelf = contexts.get(browser);
  if (shelf === undefined) {
    shelf = new Shelf(async (context) => context.close());
    contexts.set(browser, shelf);
  }
  return shelf.lease(JSON.stringify(options), async () => browser.newContext(options));
}

/** A context of the caller's own, closed by its release. */
export async function ownContext(browser: Browser, options: BrowserContextOptions): Promise<Lease<BrowserContext>> {
  const context = await browser.newContext(options);
  return owned(context, async () => context.close());
}

function owned<T>(value: T, close: () => Promise<void>): Lease<T> {
  let released = false;
  return {
    value,
    async release(): Promise<void> {
      if (released) return;
      released = true;
      await close();
    },
  };
}
