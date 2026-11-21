// compass: variance-authority.harness
import type { Frame, Page, Request } from 'playwright-core';
import type { Elsewhere } from './surface.js';

const MODALS = ':modal, [aria-modal="true"]';

/**
 * Follows the three ways an app leaves the page a test declared outcomes on:
 * the page navigates, another page opens from it, or a modal dialog covers it.
 * Followed from before the act, so none it causes is missed.
 */
export async function elsewhere(page: Page): Promise<Elsewhere> {
  let went: string | undefined;
  let opened = false;
  // A navigation request of this page's own frame is a new document; a history
  // or hash change makes none.
  let loaded = false;
  const navigated = (frame: Frame): void => {
    if (frame !== page.mainFrame()) return;
    const { pathname, search, hash } = new URL(frame.url());
    went = `${pathname}${search}${hash}`;
  };
  const popup = (): void => {
    opened = true;
  };
  // Playwright announces a new page once its document has begun to answer, and
  // the request for that document is none of this page's: a slow one would
  // leave the page quiet with the app already on its way out.
  const asked = (request: Request): void => {
    if (!request.isNavigationRequest()) return;
    try {
      if (request.frame() === page.mainFrame()) loaded = true;
    } catch {
      // Playwright's documented case: `frame()` throws for a navigation request
      // issued before its frame is created, which is a new page's document.
      opened = true;
    }
  };
  // A modal is `:modal` or marked `aria-modal`, as component libraries draw
  // one, and is new when it is visible and was not before, so one mounted
  // hidden and then shown counts: the document surface's rule.
  const before = await page.evaluateHandle(
    (query) => [...document.querySelectorAll(query)].filter((each) => each.checkVisibility()),
    MODALS,
  );
  page.on('framenavigated', navigated);
  page.on('popup', popup);
  page.context().on('request', asked);
  return {
    left: async () => {
      // A new document, a new page or a modal is told before a new address:
      // each rules out staying, and an address change alone does not.
      if (loaded && went !== undefined) return { by: 'document', words: `a new document at ${went}` };
      if (opened) return { by: 'page', words: 'a new page opened' };
      const opens = await page.evaluate(
        ([query, open]) =>
          [...document.querySelectorAll(query)].some((each) => each.checkVisibility() && !open.includes(each)),
        [MODALS, before] as const,
      );
      if (opens) return { by: 'modal', words: 'a modal dialog opened' };
      return went === undefined ? undefined : { by: 'address', words: `the page went to ${went}` };
    },
    stop: () => {
      page.off('framenavigated', navigated);
      page.off('popup', popup);
      page.context().off('request', asked);
      void before.dispose().catch(() => undefined);
    },
  };
}
