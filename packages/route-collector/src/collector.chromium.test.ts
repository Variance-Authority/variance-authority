import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeCollector, type Collector, type Plan } from './index.js';

/**
 * The `list` arm, driven against pages a real server served.
 *
 * This suite exists because of a sentence in `surface.md`: `subjects.kind:
 * "list"` parses, plans and is unit-tested with a fake collector, and **no real
 * suite had ever entered through it** — "the reverse of the usual failure and
 * still a failure". A unit test with a fake page would reproduce that failure
 * exactly, so the pages here are served over a socket and read by a browser.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const PAGES: Readonly<Record<string, string>> = {
  '/ready': `<!doctype html><html><body><main id="app">
      <section data-testid="panel"><h1>Checkout</h1><p>Two items</p></section>
    </main></body></html>`,
  // Attaches its marker late, which is the whole reason `ready` is per route: a
  // page that fetches after load exists *before* its content does, and `load`
  // has already fired by then.
  '/deferred': `<!doctype html><html><body><main id="app">loading…</main>
      <script>setTimeout(() => {
        document.querySelector('#app').innerHTML =
          '<section data-testid="late"><h1>Arrived</h1></section>';
      }, 120)</script></body></html>`,
};

let server: Server | undefined;
let base = '';
let collector: Collector | undefined;

const PLAN: Plan = {
  subjects: [
    { subject: { id: 'page/ready', kind: 'route' } },
    { subject: { id: 'page/deferred', kind: 'route' } },
    { subject: { id: 'page/missing', kind: 'route' } },
  ],
  notObserved: [],
  warnings: [],
};

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
  base = `http://127.0.0.1:${port}`;

  collector = await routeCollector({
    routes: {
      'page/ready': `${base}/ready`,
      'page/deferred': `${base}/deferred`,
    },
    roots: ['#app'],
    ready: { 'page/deferred': '[data-testid="late"]' },
    readyTimeoutMs: 5000,
  })({
    config: {
      viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
    },
    plan: PLAN,
  });
}, 120_000);

afterAll(async () => {
  await collector?.close();
  server?.closeAllConnections();
  if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

// Announced at module scope, because that is the only place a reader of a
// skipped run sees anything: vitest's default reporter never prints a skipped
// test's name, and CI runs the default reporter.
if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/route-collector: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

chromium_('a run over routes', () => {
  it('returns the plan the run computed, rather than inventing one', async () => {
    // The `list` arm's whole shape: the CLI plans from `subjects.ids` and the
    // collector says where each id lives. A collector that planned for itself
    // would make the config's ids decorative.
    await expect(collector!.plan()).resolves.toEqual(PLAN);
  });

  it('collects a served page as a document and a snapshot from one read', async () => {
    const collected = await collector!.collect(PLAN.subjects[0]!);

    expect(collected.ok).toBe(true);
    if (!collected.ok) return;

    // Both products, from one read of one mount. Two reads would be two states,
    // and any disagreement between the image and the names attached to it would
    // be a story about which of them was looking at what.
    expect(collected.document.subject).toEqual({ id: 'page/ready', kind: 'route' });
    expect(collected.document.html).toContain('Checkout');
    expect(collected.snapshot).toBeDefined();
  }, 60_000);

  it('bounds the subject to the declared root, so page chrome stays out', async () => {
    const collected = await collector!.collect(PLAN.subjects[0]!);

    expect(collected.ok).toBe(true);
    if (!collected.ok) return;

    // `#app`, not `body`. If the root were ignored the document would carry the
    // whole page, and every subject would move whenever anything outside it did.
    expect(collected.document.html).not.toContain('<body');
  }, 60_000);

  it('waits for a declared marker, and captures what arrived after load', async () => {
    // The reason `ready` is per route. `load` fires when the document is parsed,
    // which for this page is while it still says "loading…" — a run without the
    // marker photographs the placeholder and calls it the component.
    const collected = await collector!.collect(PLAN.subjects[1]!);

    expect(collected.ok).toBe(true);
    if (!collected.ok) return;
    expect(collected.document.html).toContain('Arrived');
    expect(collected.document.html).not.toContain('loading…');
  }, 60_000);

  it('reports an id with no route rather than dropping it', async () => {
    // A run that observes two of three subjects and says nothing about the third
    // is the silence this project refuses. It travels as a value, not an
    // exception, so one missing route does not cost the others their captures.
    const collected = await collector!.collect(PLAN.subjects[2]!);

    expect(collected.ok).toBe(false);
    if (collected.ok) return;
    expect(collected.because).toContain('page/missing');
  }, 60_000);
});
