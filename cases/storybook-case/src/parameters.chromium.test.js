import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storybookCollector } from '@variance-authority/storybook-collector';

/**
 * A story's `parameters.variance` is read when the story is reached, not before.
 *
 * Storybook's index names every story and carries none of its parameters, so the
 * width list and the exclusion a story declares are only known once its file
 * has been imported. Importing every file up front to find out costs the whole
 * Storybook before the first story, and leaves each file's first story timed as
 * if its import were free. Loading a story and finding it is excluded is
 * cheaper than loading all of them to learn which.
 *
 * So this file counts what the preview fetches. The server below is the
 * collector's, handed in as `baseUrl`, and it remembers every story file it
 * served: planning fetches none, and each story fetches its own file and no
 * other. What the parameters used to decide still arrives — the widths as their
 * own subjects with their own ids, the exclusion with its reason — from the same
 * single document.
 *
 * Skipped, loudly, without a build or a browser.
 */

const ROOT = join(process.cwd(), 'cases', 'storybook-case');
const STATIC_DIR = join(ROOT, 'storybook-static');
const INDEX = join(STATIC_DIR, 'index.json');

const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const READY = existsSync(INDEX) && BROWSER_AVAILABLE;

if (!READY) {
  console.warn(
    '\ncases/storybook-case (parameters): skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (existsSync(INDEX)
        ? ''
        : '\n  no Storybook — yarn workspace @variance-authority/case-storybook build-storybook') +
      '\n',
  );
}

const VIEWPORT = { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' };
const CONFIG = { viewport: VIEWPORT, subjects: { index: INDEX } };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** A built story file is a chunk named after its module: `card.stories-<hash>.js`. */
const STORY_FILE = /\/([^/]+\.stories)-[^/]*\.js$/;

/** Every story file the preview asked for, in order, and every document it loaded. */
const fetched = { stories: [], documents: 0 };

function serveStatic(root) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const resolved = join(root, normalize(path === '/' ? '/index.html' : path));

    if (!resolved.startsWith(root) || !existsSync(resolved)) {
      response.writeHead(404).end('not found');
      return;
    }

    const story = STORY_FILE.exec(path);
    if (story !== null) fetched.stories.push(story[1]);
    if (path === '/iframe.html') fetched.documents += 1;

    response.writeHead(200, { 'content-type': TYPES[extname(resolved)] ?? 'application/octet-stream' });
    response.end(readFileSync(resolved));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** The plan the CLI computes from the index: every story once, nothing from its parameters. */
function planOf(index) {
  return {
    subjects: Object.values(index.entries)
      .filter((entry) => entry.type === 'story')
      .map((entry) => ({
        subject: { id: `story:${entry.id}`, kind: 'story' },
        title: entry.title,
        name: entry.name,
        declaredIn: entry.importPath.replace(/^\.\//, ''),
      })),
    notObserved: [],
    warnings: [],
  };
}

let server;
let collector;
let plan;

beforeAll(async () => {
  if (!READY) return;
  const started = await serveStatic(STATIC_DIR);
  server = started.server;
  plan = planOf(JSON.parse(readFileSync(INDEX, 'utf8')));
  collector = await storybookCollector({ baseUrl: `http://127.0.0.1:${started.port}`, network: false })({
    config: CONFIG,
    plan,
  });
}, 120_000);

afterAll(async () => {
  await collector?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
});

const planned = (id) => plan.subjects.find((entry) => entry.subject.id === `story:${id}`);

const live = READY ? describe : describe.skip;

// In order: each test reads what the ones before it left fetched.
live('story parameters, read at the visit', () => {
  it('plans from the index alone, with no story file fetched', async () => {
    expect(await collector.plan()).toEqual(plan);
    expect(fetched.stories).toEqual([]);
  });

  it("fetches a story's own file when the story is reached, and no other", async () => {
    const collected = await collector.collect(planned('case-surface--button-primary'));

    expect(collected.ok).toBe(true);
    expect(fetched.stories).toEqual(['button.stories']);
  });

  it('reads a story at each width it declares, each its own subject, on the page it was loaded in', async () => {
    const visit = await collector.collect(planned('case-surface--receipt-at-two-widths'));

    expect(visit.subjects.map((entry) => entry.planned.subject.id)).toEqual([
      'story:case-surface--receipt-at-two-widths@375',
      'story:case-surface--receipt-at-two-widths@800',
    ]);
    expect(visit.subjects.map((entry) => entry.planned.name)).toEqual([
      'Card — receipt at two widths @375',
      'Card — receipt at two widths @800',
    ]);
    expect(visit.subjects.map((entry) => entry.planned.viewport)).toEqual([
      { ...VIEWPORT, width: 375 },
      { ...VIEWPORT, width: 800 },
    ]);
    expect(visit.subjects.map((entry) => entry.collected.ok)).toEqual([true, true]);
    expect(fetched.stories).toEqual(['button.stories', 'card.stories']);
  });

  it('reads one width again by its own id', async () => {
    const again = await collector.collect({
      ...planned('case-surface--receipt-at-two-widths'),
      subject: { id: 'story:case-surface--receipt-at-two-widths@800', kind: 'story' },
    });

    expect(again.subjects.map((entry) => entry.planned.subject.id)).toEqual([
      'story:case-surface--receipt-at-two-widths@800',
    ]);
  });

  it('skips a story that excludes itself, and says why', async () => {
    expect(await collector.collect(planned('case-surface--receipt-not-read'))).toEqual({
      ok: false,
      excluded: true,
      because: 'excluded by its own parameters (`variance.exclude`)',
    });
  });

  it('did all of it in one document', () => {
    expect(fetched.documents).toBe(1);
    expect(fetched.stories).toEqual(['button.stories', 'card.stories']);
  });
});
