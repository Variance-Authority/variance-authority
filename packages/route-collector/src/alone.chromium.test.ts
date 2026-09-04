import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeCollector, type Collected, type Collector, type Plan } from './index.js';

/**
 * `collectAlone`, against the leak it exists to name.
 *
 * A run holds one browser open for every subject in it, and that saving is what
 * makes the tool affordable. The bill arrives as a verdict nobody can act on:
 * subject B moved, and the diff cannot say whether the component changed or
 * whether subject A ran first. `order-dependent` is the answer, and it is only
 * an answer if a second reading can be taken with nothing else in the world.
 *
 * Both halves are asserted here, because either one alone proves nothing.
 *
 * - A subject nothing pollutes must come back **identical** from the isolated
 *   reading. An isolation that also changed the viewport, the asset URLs or the
 *   ready selector would report order dependence on every changed subject in
 *   every suite, and it would look exactly like this working.
 * - A subject another route polluted must come back **different**, so the
 *   difference the run is asking about is gone when nothing else has run.
 *
 * The leak is `localStorage`, which is the honest shape for a route run: routes
 * navigate per subject, so nothing survives in the *document* — what survives is
 * the origin underneath it. A cookie, a stored key, an IndexedDB record or a
 * registered service worker all outlive a navigation, and a fresh browser has
 * none of them.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/route-collector (alone): skipped, no browser — npx playwright install chromium\n',
  );
}

/** Reads the origin's own leftovers, which is the only thing that varies here. */
const READER = `<!doctype html><html><body><main id="app">
    <section data-testid="panel" class="accent-none"><h1>Cart</h1><p>Accent: none</p></section>
  </main>
  <script>
    var accent = window.localStorage.getItem('case-accent');
    if (accent !== null) {
      var panel = document.querySelector('[data-testid="panel"]');
      panel.className = 'accent-' + accent;
      panel.querySelector('p').textContent = 'Accent: ' + accent;
    }
  </script></body></html>`;

const PAGES: Readonly<Record<string, string>> = {
  '/reader': READER,
  // The polluter. A real one is a theme toggle, a feature flag cached on first
  // visit, or an auth token — this is the same mechanism with the incident
  // removed.
  '/writer': `<!doctype html><html><body><main id="app">
      <section data-testid="panel"><h1>Settings</h1></section>
    </main>
    <script>window.localStorage.setItem('case-accent', 'crimson')</script></body></html>`,
  // Depends on nothing the browser carries between routes.
  '/steady': `<!doctype html><html><body><main id="app">
      <section data-testid="panel"><h1>About</h1><p>Nothing to remember</p></section>
    </main></body></html>`,
};

const PLAN: Plan = {
  subjects: [
    { subject: { id: 'page/reader', kind: 'route' } },
    { subject: { id: 'page/writer', kind: 'route' } },
    { subject: { id: 'page/steady', kind: 'route' } },
  ],
  notObserved: [],
  warnings: [],
};

let server: Server | undefined;
let collector: Collector | undefined;

/** Narrowed at the assertion, so a refusal reports its own sentence. */
function documentOf(collected: Collected): unknown {
  if (!collected.ok) throw new Error(collected.because);
  return collected.document;
}

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((request, response) => {
    const body = PAGES[(request.url ?? '/').split('?')[0] ?? '/'];
    if (body === undefined) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  });

  const port = await new Promise<number>((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      resolve(address === null || typeof address === 'string' ? 0 : address.port);
    });
  });
  const base = `http://127.0.0.1:${port}`;

  collector = await routeCollector({
    routes: {
      'page/reader': `${base}/reader`,
      'page/writer': `${base}/writer`,
      'page/steady': `${base}/steady`,
    },
    roots: ['#app'],
  })({
    config: {
      viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
    },
    plan: PLAN,
  });
}, 120_000);

afterAll(async () => {
  await collector?.close();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

const live = BROWSER_AVAILABLE ? describe : describe.skip;

live('a subject nothing else touched', () => {
  it('reads the same document alone as it does in the shared world', async () => {
    // The half that keeps the other half honest. `collectAlone` rebuilds the
    // whole world — a browser, a context, a page, a navigation — and everything
    // about the reading other than isolation has to survive that: the viewport,
    // the roots, the ignore rules, the wiring band, the address and therefore
    // every asset URL and the environment key built from them. One of them
    // drifting would make this a difference, and a run would then report order
    // dependence about a suite that has none.
    const planned = { subject: { id: 'page/steady', kind: 'route' as const } };

    const shared = documentOf(await collector!.collect(planned));
    const alone = documentOf(await collector!.collectAlone!(planned));

    expect(alone).toEqual(shared);
  }, 120_000);
});

live('a subject an earlier route polluted', () => {
  it('reads the shared world differently once the earlier route has run', async () => {
    // The premise, established rather than assumed. Without this the next
    // assertion would pass over a suite that never leaked.
    const reader = { subject: { id: 'page/reader', kind: 'route' as const } };

    const before = documentOf(await collector!.collect(reader));
    await collector!.collect({ subject: { id: 'page/writer', kind: 'route' as const } });
    const after = documentOf(await collector!.collect(reader));

    expect(after).not.toEqual(before);
  }, 120_000);

  it('reads it as it was when nothing else has run', async () => {
    // The whole product. The shared world still holds what `page/writer` left
    // behind — the previous test ran it and nothing clears it — so the reading
    // that comes back clean can only have come back clean because the world was
    // rebuilt.
    const reader = { subject: { id: 'page/reader', kind: 'route' as const } };

    const polluted = documentOf(await collector!.collect(reader));
    const alone = documentOf(await collector!.collectAlone!(reader));

    expect(alone).not.toEqual(polluted);
    expect(JSON.stringify(polluted)).toContain('accent-crimson');
    expect(JSON.stringify(alone)).toContain('accent-none');
  }, 120_000);
});
