import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectStories } from '@variance-authority/storybook';

/**
 * Standing an addon down, against the addon.
 *
 * `@storybook/addon-a11y` with `test` set runs axe in `afterEach`, on every
 * story. A visual pass pays for that twice — once for the scan, once for the
 * phase the pass has to wait out before it can switch stories — and reads the
 * answer never. The adapter therefore says `a11y.manual` on the preview's own
 * channel, which is the switch the manager's Accessibility panel flips.
 *
 * Every claim in that paragraph is about somebody else's package, which is why
 * this file exists. The unit suite can only show that the adapter emits
 * `updateGlobals` with a particular payload; whether *this addon*, at the
 * version this repository resolves, stops scanning when it hears it is a
 * question only the addon can answer. It answers where the addon files its
 * findings: a completed scan is a `reporting.addReport({ type: 'a11y' })`, and
 * those reports ride out on `storyFinished`. So a story that scanned is a
 * `storyFinished` carrying an `a11y` reporter, and counting those counts scans.
 * The addon's own `storybook/a11y/result` event is not the observable — that one
 * answers the panel's manual re-runs, not the automatic pass.
 *
 * The negative claim matters more than the positive one and is pinned here too.
 * Passing `globals: {}` leaves the preview exactly as the project configured it
 * and the scans come back — so what the default suppresses is a scan inside a
 * document this session opened and will close, not a project's accessibility
 * run. Nothing here edits this Storybook's configuration, and the assertion
 * below would fail if it did.
 *
 * Its own build, because the addon changes the subject: installed in the
 * Storybook every other case test reads, it moves the props digest the collector
 * takes off a card, and not even consistently between two renders. So
 * `.storybook-a11y` is a second configuration over the same stories — that
 * file says the rest — and this is the only suite that reads it.
 *
 * Skipped, loudly, when that build is missing. Run:
 *   yarn workspace @variance-authority/case-storybook build-storybook:a11y
 */

const STATIC_DIR = join(process.cwd(), 'cases', 'storybook-case', 'storybook-a11y');

/**
 * Three stories, because the interesting number is per-story.
 *
 * Globals are set over the channel after navigation, and the first story of a
 * session is already selected by the URL that loaded the preview — so it may
 * have scanned before anything could ask it not to. The claim is therefore about
 * what the *session* costs rather than about story one: suppressed, the scans
 * stop; unsuppressed, they keep arriving for as long as there are stories.
 */
const STORIES = [
  'case-surface--button-primary',
  'case-surface--button-secondary',
  'case-surface--revealed',
];

/** Where a finished render files what ran inside it. */
const FINISHED = 'storyFinished';

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
    '\ncases/storybook-case (globals): skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (BUILT
        ? ''
        : '\n  no Storybook — yarn workspace @variance-authority/case-storybook build-storybook:a11y') +
      '\n',
  );
}

/**
 * Count the addon's results across one session.
 *
 * The counter is installed with `addInitScript`, before any document of this
 * page exists, because the preview boots its channel during the first
 * navigation — a listener attached afterwards would miss whatever story the URL
 * already selected. It re-attaches itself on every document for the same reason,
 * and polls for the channel rather than assuming it is there, since the page
 * script runs before Storybook's own.
 */
async function countingPage(options) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

  await page.addInitScript((event) => {
    window.__variance_case_a11y__ = [];
    const attach = () => {
      const channel = window.__STORYBOOK_PREVIEW__?.channel ?? window.__STORYBOOK_ADDONS_CHANNEL__;
      if (channel === undefined) return false;
      channel.on(event, (payload) => {
        const reporters = payload?.reporters ?? [];
        if (reporters.some((reporter) => reporter?.type === 'a11y'))
          window.__variance_case_a11y__.push(payload?.storyId ?? null);
      });
      return true;
    };
    if (!attach()) {
      const timer = setInterval(() => {
        if (attach()) clearInterval(timer);
      }, 10);
    }
  }, FINISHED);

  try {
    const outcomes = await collectStories(page, STORIES, { baseUrl, ...options });
    const scanned = await page.evaluate(() => window.__variance_case_a11y__ ?? []);
    return { outcomes, scanned };
  } finally {
    await page.close();
  }
}

live('a pass that tells the preview what it is for', () => {
  it('stops the a11y addon scanning every story of the run', async () => {
    const { outcomes, scanned } = await countingPage({});

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rendered', 'rendered', 'rendered']);

    // At most the one the URL had already started before anything could speak to
    // the preview. Never the whole run.
    expect(scanned.length).toBeLessThanOrEqual(1);
  }, 120_000);

  it('leaves the preview alone when the caller asks for nothing', async () => {
    // The same three stories, the same build, the same configuration file. The
    // only difference is the sentence the pass says to the preview — which is the
    // proof that the suppression lives in the session and not in the project.
    const { outcomes, scanned } = await countingPage({ globals: {} });

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rendered', 'rendered', 'rendered']);
    expect(scanned).toHaveLength(STORIES.length);
  }, 120_000);
});
