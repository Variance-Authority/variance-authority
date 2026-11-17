import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeCollector, type Collector } from './index.js';

// What the default recipe leaves waiting: a route whose web font never answers
// is refused, and the refusal names the font. The animation and motion cases of
// the same recipe are `stabilization.chromium.test.ts`.

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

/**
 * A web font the page asks for after `load`, served by a route that never answers.
 *
 * After `load` because a font the parser meets holds `load` itself, and the
 * navigation's own timeout then refuses the route. One applied by a script is
 * what a component mounted late looks like, and it reaches `fonts.ready` with
 * the request still open. A second is declared in a sheet the page imports.
 *
 * The page's timers run a hundred times fast, so the font trick's 15000ms bound
 * expires after 150ms: the case is about what the refusal names, and a bound
 * that ends without an answer is the only way to reach it.
 */
const LATE_FONT_PAGE = `<!doctype html><html><head><script>
  const later = setTimeout;
  window.setTimeout = (callback, delay = 0, ...rest) => later(callback, delay / 100, ...rest);
</script><style>
  @import url(/faces.css);
  @font-face { font-family: Stalled; src: url(/stalled.woff2) format('woff2'); }
  .mounted p { font-family: Stalled, sans-serif; }
  .mounted span { font-family: Imported, sans-serif; }
</style></head><body><main id="app"><p>Hello</p><span>there</span></main>
<script>addEventListener('load', () => document.body.classList.add('mounted'));</script>
</body></html>`;
const FACES = "@font-face { font-family: Imported; src: url(/imported.woff2) format('woff2'); }";

let server: Server | undefined;
let base = '';

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  // A `.woff2` request is held open and never answered.
  server = createServer((request, response) => {
    if (request.url?.endsWith('.woff2')) return;
    if (request.url === '/faces.css') return void response.end(FACES);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(LATE_FONT_PAGE);
  });

  const port = await new Promise<number>((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      resolve(address === null || typeof address === 'string' ? 0 : address.port);
    });
  });
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server?.closeAllConnections();
  if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

describe.skipIf(!BROWSER_AVAILABLE)('what the default recipe leaves waiting', () => {
  // A throw is as good an answer as a refusal, provided it names the cause. The
  // collector's own bound is what each case pays, and what it is judged on.
  // With the wire on, the URL that never answered names it, before the font
  // trick's own bound would. With it off, the trick names the family and the
  // source its rule asked for, at its own bound in the page's fast time.
  it.each([
    { wire: 'on', network: undefined, named: [/no answer.*\/stalled\.woff2/, /\/imported\.woff2/] },
    { wire: 'off', network: false as const, named: [/Stalled from url\(.*\/stalled\.woff2/, /Imported from url\(.*\/imported\.woff2/] },
  ])('refuses a route whose web font never answers, naming it, with the wire $wire', async ({ network, named }) => {
    const collector: Collector = await (
      await routeCollector({ routes: { 'page/late-font': `${base}/late-font` }, roots: ['#app'], ...(network === undefined ? {} : { network }) })
    )({
      config: { viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' }, fonts: [] },
      plan: { subjects: [{ subject: { id: 'page/late-font', kind: 'route' } }], notObserved: [], warnings: [] },
    });

    try {
      const outcome = await collector
        .collect({ subject: { id: 'page/late-font', kind: 'route' } })
        .catch((error: unknown) => ({ ok: false, because: String(error) }));

      for (const cause of named) expect(outcome).toMatchObject({ ok: false, because: expect.stringMatching(cause) });
    } finally {
      await collector.close();
    }
  });
});
