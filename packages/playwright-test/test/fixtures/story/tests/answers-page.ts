import type { Page, Route } from '@playwright/test';
import { PAGE } from './shop-page.js';

// A page that sends three requests at one click, and a hold on each the spec
// answers when it chooses, so the line each answer lands on is the spec's to say.

const API = 'http://shop.test/api/';

export const SAVING = `${PAGE}
<button id="save" onclick="
  fetch('${API}order', { method: 'POST', body: 'tea' });
  fetch('${API}price?token=secret');
  fetch('${API}stock');
">Save</button>`;

/** The page's API requests, each held until the spec answers it. */
export async function holdApi(page: Page) {
  const held = new Map<string, { readonly route: Promise<Route>; readonly arrived: (route: Route) => void }>();
  const hold = (path: string) => {
    let entry = held.get(path);
    if (entry === undefined) {
      let arrived!: (route: Route) => void;
      const route = new Promise<Route>((resolve) => (arrived = resolve));
      entry = { route, arrived };
      held.set(path, entry);
    }
    return entry;
  };
  const of = (path: string): Promise<Route> => hold(path).route;
  const pathOf = (request: { url(): string }) => new URL(request.url()).pathname;
  const named = (path: string) => (request: { url(): string }) => pathOf(request) === path;
  await page.route(`${API}**`, (route) => hold(pathOf(route.request())).arrived(route));
  return {
    /** Resolves once the page has sent `path`. */
    sent: async (path: string): Promise<void> => void (await of(path)),
    /** Answer `path` with `status`, and resolve once the page has it. */
    answer: async (path: string, status: number): Promise<void> => {
      const finished = page.waitForEvent('requestfinished', named(path));
      await (await of(path)).fulfill({ status, headers: { 'access-control-allow-origin': '*' }, body: 'ok' });
      await finished;
    },
    /** Fail `path`, and resolve once the page knows. */
    fail: async (path: string): Promise<void> => {
      const failed = page.waitForEvent('requestfailed', named(path));
      await (await of(path)).abort();
      await failed;
    },
  };
}
