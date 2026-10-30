import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeCollector, type Collector, type CollectorConfig, type Plan } from './index.js';

/**
 * A route read whose server stops answering partway through.
 *
 * One page that fails is that page's business: the run records it and reads
 * the rest. A server that refuses the connection is the run's business: every
 * route still to come would be refused the same way, and fifty identical
 * failures bury the one line that says the server went away.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const CONFIG: CollectorConfig = {
  viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
};

const planOf = (...ids: string[]): Plan => ({
  subjects: ids.map((id) => ({ subject: { id, kind: 'route' } })),
  notObserved: [],
  warnings: [],
});

let server: Server | undefined;
let base = '';
let collector: Collector | undefined;

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    // An empty response: the connection was accepted and closed with nothing
    // on it. The server is alive and only this page failed.
    if (path === '/broken') {
      request.socket.destroy();
      return;
    }
    response
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(`<!doctype html><html><body><main id="app"><h1>${path}</h1></main></body></html>`);
  });

  const port = await new Promise<number>((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      resolve(address === null || typeof address === 'string' ? 0 : address.port);
    });
  });
  base = `http://127.0.0.1:${port}`;

  // The world opens on the first route, so the one that fails is not first.
  collector = await routeCollector({
    routes: {
      'page/one': `${base}/one`,
      'page/late': `${base}/late`,
      'page/two': `${base}/two`,
    },
    roots: ['#app'],
    ready: { 'page/late': '[data-testid="never"]' },
    readyTimeoutMs: 500,
  })({ config: CONFIG, plan: planOf('page/one', 'page/late', 'page/two') });
}, 120_000);

afterAll(async () => {
  await collector?.close();
  server?.closeAllConnections();
  if (server?.listening === true) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/route-collector: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

chromium_('a server that stops answering', () => {
  it('records one page that never became ready, and reads the next one', async () => {
    const late = await collector!.collect({ subject: { id: 'page/late', kind: 'route' } });
    expect(late.ok).toBe(false);

    const next = await collector!.collect({ subject: { id: 'page/two', kind: 'route' } });
    expect(next.ok).toBe(true);
  }, 60_000);

  it('records an empty response as that page failing, not the server', async () => {
    // A connection the server accepted and closed is one bad answer from a
    // server that is still there. In its own world, because the browser's
    // error page arrives after the failed navigation has returned.
    const alone = await routeCollector({
      routes: { 'page/one': `${base}/one`, 'page/broken': `${base}/broken` },
      roots: ['#app'],
    })({ config: CONFIG, plan: planOf('page/one', 'page/broken') });

    try {
      const broken = await alone.collect({ subject: { id: 'page/broken', kind: 'route' } });
      expect(broken.ok).toBe(false);
      if (broken.ok) return;
      expect(broken.because).toContain('net::ERR_EMPTY_RESPONSE');
    } finally {
      await alone.close();
    }
  }, 60_000);

  it('ends the read at the first refused connection, as an operator error', async () => {
    server!.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));

    // Rejected rather than resolved with `ok: false`. A resolved failure is
    // about this subject, and the run would go on to ask for every route left,
    // each refused the same way. The marker is what makes the CLI exit as an
    // operator error rather than as changes awaiting review.
    const read = collector!.collect({ subject: { id: 'page/one', kind: 'route' } });
    await expect(read).rejects.toMatchObject({ varianceOperatorError: true });
    await expect(read).rejects.toThrow(`nothing is listening at ${base}`);
    await expect(read).rejects.toThrow('`page/one`');
  }, 60_000);
});
