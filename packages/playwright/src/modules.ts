import type { FetchModule } from '@variance-authority/core';
import type { Page } from 'playwright';

/**
 * Fetching a served module, so a stack frame can become a line of source.
 *
 * The zero-install provenance path ends here. A fiber carries the position of a
 * call site in the module the browser was *served*; the file a reviewer opens is
 * one source map away, and the map is in that module — which nothing in the page
 * should be spending its render budget on retrieving.
 *
 * **Fetched from inside the page, not from Node.** The URLs come from a stack
 * the browser wrote, so the page is where they are already correct: it holds the
 * origin, the cookies, the dev server's session, and any header a proxy in front
 * of it wants. A Node-side fetch of `http://localhost:6006/src/App.tsx` works
 * until the harness sits behind an auth wall or a self-signed certificate the
 * browser was told to trust and Node was not — at which point provenance
 * quietly stops resolving and nothing says why.
 *
 * Total by construction. A module that 404s, a page that navigated away
 * mid-flight, a context that closed — each is one node reporting no location,
 * which is a state the whole provenance path already treats as normal.
 */
export function fetchModules(page: Page): FetchModule {
  return async (url) => {
    try {
      return await page.evaluate(async (target: string) => {
        const response = await fetch(target, { credentials: 'same-origin' });
        return response.ok ? await response.text() : null;
      }, url);
    } catch {
      return null;
    }
  };
}
