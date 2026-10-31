import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectStories } from '@variance-authority/storybook';
import { unbuilt } from '../../unbuilt.mjs';

/**
 * Stories switched on one page, with the isolator putting module state back
 * between them.
 *
 * `Isolated/Tally` counts in a module variable from its loader. On one document
 * the module loads once, so every story after the first would read what the
 * story before it wrote. The isolated build rewrites the module and its first
 * project loader starts a new session per story; the two stories marked
 * `sharedModules` skip that loader and show the leak the reset prevents.
 *
 * Skipped, loudly, when the build is missing. Run:
 *   yarn workspace @variance-authority/case-storybook build-storybook:isolated
 */

const STATIC_DIR = join(process.cwd(), 'cases', 'storybook-case', 'storybook-isolated');
const STORIES = ['isolated-tally--first', 'isolated-tally--second', 'isolated-tally--shared-first', 'isolated-tally--shared-second'];

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
/**
 * One browser for the file and one page for the test, never one per story: the
 * page is the session whose module state the stories would share.
 */
let browser;
let baseUrl = '';

beforeAll(async () => {
  if (!BUILT || !BROWSER_AVAILABLE) return;
  const started = await serveStatic(STATIC_DIR);
  server = started.server;
  baseUrl = `http://127.0.0.1:${started.port}`;
  browser = await chromium.launch({ headless: true });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
});

const live = BUILT && BROWSER_AVAILABLE ? describe : describe.skip;

if (!BUILT || !BROWSER_AVAILABLE) {
  unbuilt(
    '\ncases/storybook-case (isolated): skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (BUILT ? '' : '\n  no Storybook — yarn workspace @variance-authority/case-storybook build-storybook:isolated') +
      '\n',
  );
}

live('stories switched on one page under the isolator', () => {
  it('starts every story from the module as it loaded, and only the stories that opt out read the one before', async () => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    const shown = [];

    try {
      const outcomes = await collectStories(page, STORIES, {
        baseUrl,
        observe: async () => {
          shown.push(await page.locator('#storybook-root output').textContent());
        },
      });

      expect(outcomes.map((outcome) => outcome.status)).toEqual(STORIES.map(() => 'rendered'));
      expect(shown).toEqual(['1', '1', '2', '3']);
      expect(loads).toBe(1);
    } finally {
      await page.close();
    }
  }, 120_000);
});
