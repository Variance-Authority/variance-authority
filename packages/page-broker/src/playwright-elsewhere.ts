// compass: variance-authority.harness
import type { Dialog, Frame, Page, Request } from 'playwright-core';
import type { Elsewhere } from './surface.js';

const MODALS = ':modal, [aria-modal="true"]';

/**
 * Follows the ways an app leaves the page a test declared outcomes on: the page
 * navigates, another page opens from it, or a native or modal dialog covers it.
 * Followed from before the act, so none it causes is missed.
 */
export async function elsewhere(page: Page): Promise<Elsewhere> {
  let went: string | undefined;
  let opened = false;
  let native: string | undefined;
  // Playwright dismisses a native dialog nobody listens for; listening ends
  // that, so this listener dismisses it when it is the only one.
  const dialog = (shown: Dialog): void => {
    native ??= shown.type();
    // The count is the client's event emitter's, which Playwright's types do not name.
    if ((page as unknown as { listenerCount(event: string): number }).listenerCount('dialog') === 1) void shown.dismiss().catch(() => undefined);
  };
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
  // Which page opened a new one is Playwright's `popup` to say; the quiet
  // waits out a new page's document, so the announcement is not missed.
  const asked = (request: Request): void => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loaded = true;
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
  page.on('dialog', dialog);
  page.on('request', asked);
  return {
    left: async () => {
      // A new document, a new page or a modal is told before a new address:
      // each rules out staying, and an address change alone does not.
      if (loaded && went !== undefined) return { by: 'document', words: `a new document at ${went}` };
      if (opened) return { by: 'page', words: 'a new page opened' };
      if (native !== undefined) return { by: 'modal', words: `a native ${native} dialog opened` };
      let opens: boolean;
      try {
        opens = await page.evaluate(
          ([query, open]) =>
            [...document.querySelectorAll(query)].some((each) => each.checkVisibility() && !open.includes(each)),
          [MODALS, before] as const,
        );
      } catch (error) {
        // A new document committed during the look, and took the old one's handles with it.
        if (loaded) return { by: 'document', words: `a new document at ${went ?? new URL(page.url()).pathname}` };
        throw error;
      }
      if (opens) return { by: 'modal', words: 'a modal dialog opened' };
      return went === undefined ? undefined : { by: 'address', words: `the page went to ${went}` };
    },
    stop: () => {
      page.off('framenavigated', navigated);
      page.off('popup', popup);
      page.off('dialog', dialog);
      page.off('request', asked);
      void before.dispose().catch(() => undefined);
    },
  };
}
