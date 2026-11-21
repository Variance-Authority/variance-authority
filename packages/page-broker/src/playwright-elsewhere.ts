// compass: variance-authority.harness
import type { Frame, Page, Request } from 'playwright-core';
import type { Elsewhere } from './surface.js';

/**
 * Follows the three ways an app leaves the page a test declared outcomes on:
 * the page navigates, another page opens from it, or a modal dialog covers it.
 * Followed from before the act, so none it causes is missed.
 */
export async function elsewhere(page: Page): Promise<Elsewhere> {
  let went: string | undefined;
  let opened = false;
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
      request.frame();
    } catch {
      // A document asked for before Playwright has a frame for it is a new page's.
      opened = true;
    }
  };
  const modals = page.locator(':modal');
  const before = await modals.count();
  page.on('framenavigated', navigated);
  page.on('popup', popup);
  page.context().on('request', asked);
  return {
    left: async () => {
      if (went !== undefined) return `the page went to ${went}`;
      if (opened) return 'a new page opened';
      return (await modals.count()) > before ? 'a modal dialog opened' : undefined;
    },
    stop: () => {
      page.off('framenavigated', navigated);
      page.off('popup', popup);
      page.context().off('request', asked);
    },
  };
}
