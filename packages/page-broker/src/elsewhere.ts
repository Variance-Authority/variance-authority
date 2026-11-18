// compass: variance-authority.harness
import type { Frame, Page, Request } from '@playwright/test';

/** Whether the app, since the action began, went somewhere that is no part of the page it was on. */
export interface Elsewhere {
  /** Where it went, in words, and absent while it is where it was. */
  left(): Promise<string | undefined>;
  stop(): void;
}

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
  const opening: Promise<void>[] = [];
  const asked = (request: Request): void => {
    if (!request.isNavigationRequest()) return;
    let other: Page;
    try {
      other = request.frame().page();
    } catch {
      // A document asked for before Playwright has a frame for it is a new page's.
      opened = true;
      return;
    }
    if (other === page) return;
    opening.push(
      other.opener().then(
        (opener) => {
          if (opener === page) opened = true;
        },
        // A page gone before it could be asked is announced, or not, by `popup`.
        () => undefined,
      ),
    );
  };
  const modals = page.locator(':modal');
  const before = await modals.count();
  page.on('framenavigated', navigated);
  page.on('popup', popup);
  page.context().on('request', asked);
  return {
    left: async () => {
      await Promise.all(opening);
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
