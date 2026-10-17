import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storybookCollector } from '@variance-authority/storybook-collector';

/**
 * Where a run reads every story's parameters, against a Storybook that built
 * them.
 *
 * Reading them has Storybook's `extract()` import every story file. On the
 * document the run then shows its stories on, every file's first story would
 * find its import already done and read a `collect` near 0; loading that
 * document again to undo it costs the run a preview boot before its first
 * story. Neither happens when the reading has a document of its own.
 *
 * The server tells documents apart by a cookie it hands each browser context
 * with its first `iframe.html`, so what one context asked for is a list the
 * test can read, with no clock in it.
 *
 * Skipped, loudly, when the Storybook has not been built. Run:
 *   yarn workspace @variance-authority/case-storybook build-storybook
 */

const STATIC_DIR = join(process.cwd(), 'cases', 'storybook-case', 'storybook-static');
const INDEX = join(STATIC_DIR, 'index.json');

const BUILT = existsSync(INDEX);
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
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Paths each context asked for, in order, keyed by the cookie it was handed. */
const asked = new Map();

function serveCounting(root) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const resolved = join(root, normalize(path));
    if (!resolved.startsWith(root) || !existsSync(resolved)) {
      response.writeHead(404).end('not found');
      return;
    }

    const headers = {
      'content-type': TYPES[extname(resolved)] ?? 'application/octet-stream',
      // Every import reaches the server, so a list is every import there was.
      'cache-control': 'no-store',
    };
    let jar = /(?:^|; )jar=(\d+)/.exec(request.headers.cookie ?? '')?.[1];
    if (jar === undefined) {
      jar = String(asked.size + 1);
      headers['set-cookie'] = `jar=${jar}; Path=/`;
    }
    if (!asked.has(jar)) asked.set(jar, []);
    asked.get(jar).push(path);

    response.writeHead(200, headers);
    response.end(readFileSync(resolved));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const story = (id) => ({ subject: { id: `story:${id}`, kind: 'story' } });
/** Three stories of the card file: a plain one, one at two widths, and one that asks not to be read. */
const CARD = story('case-surface--card-with-actions');
const TWO_WIDTHS = story('case-surface--receipt-at-two-widths');
const NOT_READ = story('case-surface--receipt-not-read');

let server;
let collector;
let planned;
/** How many paths each context had asked for when the plan was in. */
let atPlan;

beforeAll(async () => {
  if (!BUILT || !BROWSER_AVAILABLE) return;
  let port;
  ({ server, port } = await serveCounting(STATIC_DIR));

  collector = await storybookCollector({ baseUrl: `http://127.0.0.1:${port}`, network: false })({
    config: {
      viewport: { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' },
      subjects: { index: INDEX },
    },
    plan: { subjects: [CARD, TWO_WIDTHS, NOT_READ], notObserved: [], warnings: [] },
  });
  planned = await collector.plan();
  atPlan = new Map([...asked].map(([jar, paths]) => [jar, paths.length]));
  const collected = await collector.collect(CARD);
  if (!collected.ok) throw new Error(collected.because);
}, 120_000);

afterAll(async () => {
  await collector?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
});

const live = BUILT && BROWSER_AVAILABLE ? describe : describe.skip;

if (!BUILT || !BROWSER_AVAILABLE) {
  console.warn(
    '\ncases/storybook-case (parameters): skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (BUILT ? '' : '\n  no build — yarn workspace @variance-authority/case-storybook build-storybook'),
  );
}

live("reading every story's parameters before the first story", () => {
  it('lays each story’s parameters over the plan', () => {
    expect(planned.subjects.map((subject) => subject.subject.id)).toEqual([
      'story:case-surface--card-with-actions',
      'story:case-surface--receipt-at-two-widths@375',
      'story:case-surface--receipt-at-two-widths@800',
    ]);
    expect(planned.notObserved).toEqual([
      expect.objectContaining({ subject: 'story:case-surface--receipt-not-read', kind: 'excluded' }),
    ]);
  });

  it('loads the document the stories are shown on once, and imports no story file on it before its story', () => {
    // The run's document is the one that asked for something after the plan.
    const shown = [...asked].filter(([jar, paths]) => paths.length > (atPlan.get(jar) ?? 0));
    expect(shown).toHaveLength(1);
    const [[jar, paths]] = shown;

    expect(paths.filter((path) => path === '/iframe.html')).toEqual(['/iframe.html']);
    expect(paths.slice(0, atPlan.get(jar)).filter((path) => path.includes('.stories-'))).toEqual([]);
    expect(paths.slice(atPlan.get(jar)).filter((path) => path.includes('.stories-'))).toEqual([
      expect.stringMatching(/^\/assets\/card\.stories-[\w-]+\.js$/),
    ]);
  });
});
