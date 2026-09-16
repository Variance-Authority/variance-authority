import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectStories } from '@variance-authority/storybook';

/**
 * The end of a render, against a Storybook that has one.
 *
 * `storyRendered` is not the end. Storybook's own order is `playing` →
 * `completing` → `completed` (which emits `storyRendered`) → `afterEach` →
 * `finished` (which emits `storyFinished`), and `afterEach` counts as pending.
 * A driver that hands a story back at `storyRendered` therefore asks for the
 * next story while this one is mid-phase, and `StoryRender.teardown` answers
 * that with three macrotask ticks of grace and then `window.location.reload()`
 * followed by a promise that never resolves.
 *
 * What that costs is not time. The reload discards the page — the injected page
 * agent, the network observations, whatever a previous story left behind that a
 * later one was going to be read against — so the run continues against a
 * document that is not the one it has been reasoning about. ADR-0009's economics
 * are one load and N subjects; a driver that reloads between subjects has
 * neither the saving nor the session.
 *
 * This is the only file in the repository that puts a real preview in that
 * phase with a story. Nothing else here can: `cases/storybook-case` has no
 * addons and, deliberately, no global decorators, so its post-render phase is
 * empty and every story in it finishes in the same tick it renders. `Revealed`
 * does not reproduce it either — a play function runs *before* `storyRendered`,
 * so by the time a driver sees that event there is nothing left pending.
 *
 * The ordinary way a real project arrives here is `@storybook/addon-a11y` with
 * `test` set, which ships an `afterEach` and runs axe inside it, on every story.
 * That addon is in this repository, in a second build of these same stories that
 * `globals.chromium.test.js` reads — but the pass under test here stands its scan
 * down, so it cannot be this file's fixture. `Button — busy after render` is the
 * same shape written out by hand, holding `afterEach` open for a span no
 * configuration can talk it out of, so this assertion depends on no addon at
 * all.
 *
 * Skipped, loudly, when the Storybook has not been built. Run:
 *   yarn workspace @variance-authority/case-storybook build-storybook
 */

const STATIC_DIR = join(process.cwd(), 'cases', 'storybook-case', 'storybook-static');

/**
 * Three stories, and the busy one is deliberately not the first.
 *
 * The first story of a session arrives selected by its URL, so `showStory` finds
 * it already rendering and settles on markup that has stopped changing — which
 * happens during `completing`, one phase *before* the one that matters.
 * `completing` is not pending, so a switch away from it tears down cleanly and
 * the defect does not appear. Reached the way every story after the first is
 * reached — over the channel, waiting for `storyRendered` — the driver is handed
 * the story at `completed`, and the very next phase is `afterEach`.
 *
 * So the order is the fixture: a plain story to spend the session's first slot,
 * the busy one, and a third to switch to while the second is still finishing.
 */
const FIRST = 'case-surface--button-primary';
/** The story that is still in `afterEach` when the next one is asked for. */
const BUSY = 'case-surface--finishes-late';
/** Plain, and labelled differently, so the last reading names itself. */
const LAST = 'case-surface--button-secondary';

const BUILT = existsSync(join(STATIC_DIR, 'index.json'));
const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** See `storybook.chromium.test.js`: the preview fetches, so `file://` is out. */
function serveStatic(root) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const resolved = join(root, normalize(path === '/' ? '/index.html' : path));

    if (!resolved.startsWith(root) || !existsSync(resolved)) {
      response.writeHead(404).end('not found');
      return;
    }

    response.writeHead(200, { 'content-type': TYPES[extname(resolved)] ?? 'application/octet-stream' });
    response.end(readFileSync(resolved));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

let server;
let browser;
let baseUrl = '';

beforeAll(async () => {
  if (!BUILT || !BROWSER_AVAILABLE) return;

  ({ server } = await serveStatic(STATIC_DIR).then((started) => {
    baseUrl = `http://127.0.0.1:${started.port}`;
    return started;
  }));

  browser = await chromium.launch({ headless: true });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
});

const live = BUILT && BROWSER_AVAILABLE ? describe : describe.skip;

if (!BUILT || !BROWSER_AVAILABLE) {
  console.warn(
    '\ncases/storybook-case (finish): skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (BUILT
        ? ''
        : '\n  no Storybook — yarn workspace @variance-authority/case-storybook build-storybook') +
      '\n',
  );
}

/**
 * A page that counts its own documents.
 *
 * `load` fires once per document, and the listener is attached before the first
 * navigation, so the count is the whole history of the page rather than a
 * difference between two samples. One load is a session. Two is a reload nobody
 * asked for, which is the defect, and counting it does not depend on guessing
 * what the reload destroyed.
 */
async function countingPage() {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const state = { loads: 0 };
  page.on('load', () => {
    state.loads += 1;
  });
  return { page, state };
}

live('a story that is still busy when the next one is asked for', () => {
  it('waits for Storybook to finish with it rather than letting the preview reload', async () => {
    const { page, state } = await countingPage();

    try {
      // Written into page scope between the two stories. A `page.evaluate`
      // preserves it and a document swap does not, so it answers a question the
      // load count cannot: not only whether the page reloaded, but whether what
      // the run had put there was still there when the next subject was read.
      const outcomes = await collectStories(page, [FIRST, BUSY, LAST], {
        baseUrl,
        observe: async (outcome) => {
          if (outcome.storyId !== BUSY) return;
          await page.evaluate(() => {
            window.__variance_case_session__ = 'installed';
          });
        },
      });

      expect(outcomes.map((outcome) => `${outcome.storyId}: ${outcome.status}`)).toEqual([
        `${FIRST}: rendered`,
        `${BUSY}: rendered`,
        `${LAST}: rendered`,
      ]);

      // The fixture only means anything if the busy story was reached the way
      // the defect needs it reached. Settling on quiescent markup would leave it
      // in `completing`, which tears down cleanly, and this test would pass
      // against a driver that does not wait at all — as it did, before this line.
      expect(outcomes[1]?.readiness).toBe('storyRendered');

      // The saving, stated as the thing it actually is: one document for both.
      expect(state.loads).toBe(1);
      expect(outcomes.filter((outcome) => outcome.navigated)).toHaveLength(1);

      expect(await page.evaluate(() => window.__variance_case_session__)).toBe('installed');

      // And the last story really is the last story rather than whatever a
      // reload would have restored.
      const rendered = await page.evaluate(
        () => document.querySelector('#storybook-root')?.textContent ?? '',
      );
      expect(rendered).toContain('Cancel');
      expect(rendered).not.toContain('Settling');
    } finally {
      await page.close();
    }
  }, 120_000);
});
