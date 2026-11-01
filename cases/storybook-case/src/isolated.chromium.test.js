import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectStories } from '@variance-authority/storybook';
import { unbuilt } from '../../unbuilt.mjs';
import { serveStatic } from '../scripts/serve.mjs';

/**
 * Stories switched on one page, with the isolator putting module state back
 * between them.
 *
 * `Isolated/Tally` counts in a module variable from its loader. On one document
 * the module loads once, so every story after the first would read what the
 * story before it wrote. The isolated build rewrites the module and starts a
 * new session on every switch, before Storybook imports the next story's file;
 * the two shared stories skip the reset and show the leak it prevents.
 * `Isolated/Reader`, a second story file, reads the count as it loads, and a
 * module it imports registers itself as it loads; it is shown again after
 * another story, when its modules are not loaded again.
 *
 * Skipped, loudly, when the build is missing. Run:
 *   yarn workspace @variance-authority/case-storybook build-storybook:isolated
 */

const STATIC_DIR = join(process.cwd(), 'cases', 'storybook-case', 'storybook-isolated');
const STORIES = [
  'isolated-tally--first',
  'isolated-tally--second',
  'isolated-tally--shared-first',
  'isolated-tally--shared-second',
  'isolated-reader--initial',
  'isolated-tally--first',
  'isolated-reader--initial',
];

const BUILT = existsSync(join(STATIC_DIR, 'index.json'));
const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

let server;
/**
 * One browser for the file, not leased: its pages are the sessions under test.
 * A page per story is the reference, what each story reads with modules of its
 * own, and one page for every story is the session they would share.
 */
let browser;
let baseUrl = '';

beforeAll(async () => {
  if (!BUILT || !BROWSER_AVAILABLE) return;
  server = await serveStatic(STATIC_DIR);
  baseUrl = server.baseUrl;
  browser = await chromium.launch({ headless: true });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
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

/** No globals to send: sending them re-renders the first story on its page, in the same session. */
const show = async (page, ids) => {
  const shown = [];
  const outcomes = await collectStories(page, ids, {
    baseUrl,
    globals: {},
    observe: async () => {
      shown.push(await page.locator('#storybook-root output').textContent());
    },
  });
  expect(outcomes.map((outcome) => outcome.status)).toEqual(ids.map(() => 'rendered'));
  return shown;
};

live('stories switched on one page under the isolator', () => {
  it('shows every story as a page of its own would, and only the stories that opt out read the one before', async () => {
    const alone = [];
    for (const id of STORIES) {
      const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
      try {
        alone.push(...(await show(page, [id])));
      } finally {
        await page.close();
      }
    }

    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    try {
      const shown = await show(page, STORIES);
      expect(alone).toEqual(['1', '1', '1', '1', '0/1', '1', '0/1']);
      // The shared stories read the two before them; `Isolated/Reader`, imported
      // after they wrote 3, reads its modules as its own page does, and still
      // holds the registration its import made when it is shown again.
      expect(shown).toEqual(['1', '1', '2', '3', '0/1', '1', '0/1']);
      expect(loads).toBe(1);
    } finally {
      await page.close();
    }
  }, 120_000);
});
