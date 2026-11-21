// compass: variance-authority.harness
import type { Locator, Page } from 'playwright-core';
import { elsewhere } from './playwright-elsewhere.js';
import { requests } from './playwright-quiet.js';
import type { Query, Surface, Target } from './surface.js';

/** A Playwright page as page-broker sees it: what is found in it is a locator, and `native` is the page. */
export type PageSurface = Surface<Page, Locator>;

interface Found extends Target<Locator> {
  readonly locator: Locator;
}

/**
 * Page-broker over a Playwright page, under any runner that drives one.
 * Parts are found with Playwright's own locators, and waited for with its own
 * wait. The page is quiet once no request has been in flight for the quiet
 * period, and acts are Playwright's, with their waiting.
 *
 * @example
 * const reached = await submit(surface(page)); // { outcome: 'payment', at: <locator> }
 */
export function surface(page: Page): PageSurface {
  const find = (query: Query): Found => {
    const locator = locate(page, query);
    // The first match that shows, as over a document: a query may match its part more than once.
    const shown = locator.filter({ visible: true }).first();
    return { locator, visible: async () => ((await shown.isVisible()) ? shown : undefined) };
  };
  return {
    native: page,
    find,
    arrival: (targets, ms) => arrival(targets as readonly Found[], ms),
    quiet: (period) => requests(period)(page),
    elsewhere: () => elsewhere(page),
    click: (query) => locate(page, query).click(),
    fill: (query, value) => locate(page, query).fill(value),
    press: (query, key) => locate(page, query).press(key),
    check: (query) => locate(page, query).check(),
    select: async (query, value) => {
      await locate(page, query).selectOption(value);
    },
  };
}

function locate(page: Page, query: Query): Locator {
  // A string matches whole, as it does over a document; a pattern matches within.
  if ('role' in query) {
    const role = query.role as Parameters<Page['getByRole']>[0];
    return query.name === undefined ? page.getByRole(role) : page.getByRole(role, { name: query.name, exact: true });
  }
  if ('text' in query) return page.getByText(query.text, { exact: true });
  if ('label' in query) return page.getByLabel(query.label, { exact: true });
  if ('testId' in query) return page.getByTestId(query.testId);
  return page.locator(query.css);
}

/** Playwright's own wait for any target, or `late` when none came in the time left. */
async function arrival(targets: readonly Found[], left: number): Promise<'arrived' | 'late'> {
  const any = targets
    .map((target) => target.locator)
    .reduce<Locator | undefined>((joined, at) => (joined === undefined ? at : joined.or(at)), undefined);
  if (any === undefined) return new Promise(() => undefined);
  try {
    // Only the visible ones are waited on: a query may match its part while it
    // is hidden, and the first match would then be one that never shows.
    // To Playwright a timeout of 0 is no timeout at all.
    await any
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout: Math.max(left, 1) });
    return 'arrived';
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') return 'late';
    throw error;
  }
}
