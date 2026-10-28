import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SemanticNode } from '@variance-authority/core/format';
import { routeCollector, type Collected, type Collector, type Plan, type RouteCollectorOptions } from './index.js';

/**
 * A component is read off a server-rendered route only once React has hydrated
 * it, and a route read before that says so.
 *
 * The page below arrives complete from the server and hydrates with a shell
 * that suspends: `Slow` reads a promise outside any `<Suspense>`, so React
 * renders `Header`, attaches a fiber to its `<span>`, and stops with the root
 * still dehydrated until the promise settles. That is the window a capture lands
 * in when hydration finishes late, and a machine running several worlds at once
 * finishes it late. From outside, the window looks like a finished commit: some
 * nodes carry a fiber and the count holds still. Only React's own record of the
 * root says the commit has not happened.
 *
 * The shell holds on a response, as a real one does on a chunk or a payload,
 * and the wait follows it: for as long as the page is still receiving, and
 * not a moment past it. A shell held on something no response settles — a
 * timer here — has nothing arriving to wait for, and is refused at once, as a
 * route still showing a Suspense fallback is: an effect that runs after
 * hydration — a mounted flag, a theme read from storage, a layout measured on
 * the client — paints a different image, so what was read is not yet the page.
 * A route no React root was found for is collected, and says so in a
 * diagnostic, because a region with no component there means something
 * different. A run that declared it reads no React (`wiring: false`) says
 * nothing, because it expected nothing.
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
    '\npackages/route-collector (hydration): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const APP = `import { use } from 'react';

export function Header() {
  return <span>early</span>;
}

export function Slow({ ready }) {
  use(ready);
  return <p>late</p>;
}

export function App({ ready }) {
  return (
    <main id="app">
      <Header />
      <Slow ready={ready} />
    </main>
  );
}
`;

/**
 * What the shell holds on, from the query string, so one page serves every
 * case: `hold` is a response the server sends after that many milliseconds,
 * `timer` a timer the page sets itself. Beside it the page may open a stream
 * that never ends (`stream`) or send a request the server drops after that many
 * milliseconds (`fail`).
 */
const READY = [
  'const query = new URLSearchParams(location.search);',
  "if (query.has('stream')) new EventSource('/events');",
  "if (query.has('fail')) fetch(`/hold?ms=${query.get('fail')}&drop`).catch(() => undefined);",
  "export const ready = query.has('timer')",
  "  ? new Promise((resolve) => setTimeout(resolve, Number(query.get('timer'))))",
  "  : fetch(`/hold?ms=${query.get('hold') ?? '0'}`).then(() => undefined);",
].join('\n');

const MAIN = [
  "import { hydrateRoot } from 'react-dom/client';",
  "import { App } from './App.jsx';",
  "import { ready } from './ready.js';",
  "hydrateRoot(document.getElementById('root'), <App ready={ready} />);",
].join('\n');

/** The markup `App` renders, as the hydration commit leaves it. */
const INDEX_HTML =
  '<!doctype html><html><body>' +
  '<div id="root"><main id="app"><span>early</span><p>late</p></main></div>' +
  '<script type="module" src="/src/main.jsx"></script></body></html>';

/**
 * The whole document hydrated as one root, the way a Next-style app router
 * does it: the container is the `Document`, so no element above the subject
 * carries the root.
 */
const WHOLE = [
  "import { hydrateRoot } from 'react-dom/client';",
  "import { App } from './App.jsx';",
  "import { ready } from './ready.js';",
  'hydrateRoot(',
  '  document,',
  '  <html>',
  '    <head />',
  '    <body>',
  '      <App ready={ready} />',
  '    </body>',
  '  </html>,',
  ');',
].join('\n');

const WHOLE_HTML =
  '<!doctype html><html><head><script type="module" src="/src/whole.jsx"></script></head>' +
  '<body><main id="app"><span>early</span><p>late</p></main></body></html>';

/**
 * A route whose client rewrites what the server sent once it has hydrated: the
 * server says `early`, an effect says `client`. Both renders agree, so React
 * reports no mismatch; the page a visitor ends on is still not the one that
 * arrived.
 */
const FLIP_APP = `import { use, useEffect, useState } from 'react';

export function Flip({ ready }) {
  use(ready);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <p>{mounted ? 'client' : 'early'}</p>;
}
`;

const FLIP = [
  "import { hydrateRoot } from 'react-dom/client';",
  "import { Flip } from './Flip.jsx';",
  "import { ready } from './ready.js';",
  "hydrateRoot(document.getElementById('app'), <Flip ready={ready} />);",
].join('\n');

const FLIP_HTML =
  '<!doctype html><html><body><main id="app"><p>early</p></main>' +
  '<script type="module" src="/src/flip-main.jsx"></script></body></html>';

/** The same markup with no client at all. */
const STATIC_HTML =
  '<!doctype html><html><body><main id="app"><span>early</span><p>late</p></main></body></html>';

/** The same again, holding open a request the server never answers, as a chat widget's long poll does. */
const POLLING_HTML =
  '<!doctype html><html><body><main id="app"><span>early</span><p>late</p></main>' +
  "<script>fetch('/poll')</script></body></html>";

const PLAN: Plan = {
  subjects: [{ subject: { id: 'page/app', kind: 'route' } }],
  notObserved: [],
  warnings: [],
};

const roots: string[] = [];
const collectors: Collector[] = [];
let server: ViteDevServer | undefined;
let base = '';

function* walk(node: SemanticNode): Generator<SemanticNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

/** Built as `wiring.chromium.test.ts` builds its own dev server, for the same reasons. */
beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  const root = realpathSync(mkdtempSync(join(tmpdir(), 'variance-hydration-')));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });

  writeFileSync(join(root, 'index.html'), INDEX_HTML);
  writeFileSync(join(root, 'static.html'), STATIC_HTML);
  writeFileSync(join(root, 'polling.html'), POLLING_HTML);
  writeFileSync(join(root, 'src', 'App.jsx'), APP);
  writeFileSync(join(root, 'src', 'main.jsx'), MAIN);
  writeFileSync(join(root, 'src', 'ready.js'), READY);
  writeFileSync(join(root, 'whole.html'), WHOLE_HTML);
  writeFileSync(join(root, 'src', 'whole.jsx'), WHOLE);
  writeFileSync(join(root, 'flip.html'), FLIP_HTML);
  writeFileSync(join(root, 'src', 'Flip.jsx'), FLIP_APP);
  writeFileSync(join(root, 'src', 'flip-main.jsx'), FLIP);
  writeFileSync(
    join(root, 'vite.config.mjs'),
    'export default {\n' +
      "  esbuild: { jsx: 'automatic' },\n" +
      "  resolve: { dedupe: ['react', 'react-dom'] },\n" +
      "  optimizeDeps: { include: ['react', 'react/jsx-dev-runtime', 'react-dom/client'] },\n" +
      '};\n',
  );
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'), 'dir');

  server = await createServer({
    root,
    configFile: join(root, 'vite.config.mjs'),
    server: { port: 0, host: '127.0.0.1', fs: { allow: [root, REPO] } },
    cacheDir: join(root, '.vite-cache'),
    logLevel: 'silent',
    plugins: [
      {
        name: 'hold',
        configureServer(dev) {
          dev.middlewares.use('/hold', (request, response) => {
            const query = new URL(request.url ?? '', 'http://hold').searchParams;
            const ms = Number(query.get('ms') ?? '0');
            setTimeout(() => (query.has('drop') ? request.socket.destroy() : response.end('held')), ms);
          });
          dev.middlewares.use('/poll', () => {});
          dev.middlewares.use('/events', (_request, response) => {
            response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
            response.write('data: open\n\n');
          });
        },
      },
    ],
  });
  await server.listen();

  await server.warmupRequest('/src/main.jsx');
  await server.warmupRequest('/src/ready.js');
  await server.warmupRequest('/src/App.jsx');
  await server.warmupRequest('/src/whole.jsx');
  await server.warmupRequest('/src/flip-main.jsx');
  await server.warmupRequest('/src/Flip.jsx');
  await server.waitForRequestsIdle();

  const address = server.httpServer?.address();
  const port = address === null || address === undefined || typeof address === 'string' ? 0 : address.port;
  base = `http://127.0.0.1:${port}/`;
}, 480_000);

afterAll(async () => {
  for (const collector of collectors) await collector.close();
  await server?.close();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function collect(address: string, options: RouteCollectorOptions = {}): Promise<Collected> {
  const collector = await routeCollector({
    routes: { 'page/app': address },
    roots: ['#app'],
    ready: { 'page/app': '#app p' },
    readyTimeoutMs: 15_000,
    ...options,
  })({
    config: {
      viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
      fonts: [],
    },
    plan: PLAN,
  });
  collectors.push(collector);

  return collector.collect(PLAN.subjects[0]!);
}

async function read(
  address: string,
  options: RouteCollectorOptions = {},
): Promise<Extract<Collected, { ok: true }>> {
  const collected = await collect(address, options);
  if (!collected.ok) throw new Error(collected.because);
  return collected;
}

/** Who wrote the `<p>`, or undefined when nothing was read off it. */
function authorOfLate(collected: Extract<Collected, { ok: true }>): string | undefined {
  if (collected.snapshot === undefined) throw new Error('collected no snapshot');
  const late = [...walk(collected.snapshot.root)].find((node) => node.tag === 'p');
  if (late === undefined) throw new Error('the snapshot holds no <p>');
  return late.provenance?.createdBy ?? late.provenance?.owners[0]?.name;
}

/** How long the reading spent waiting for React, as its steps report it. */
function hydrationMs(collected: Extract<Collected, { ok: true }>): number {
  const step = (collected.steps ?? []).find((taken) => taken.step === 'hydration');
  if (step === undefined) throw new Error('the reading took no hydration step');
  return step.ms;
}

function codes(collected: Extract<Collected, { ok: true }>): readonly string[] {
  return (collected.diagnostics ?? []).map((diagnostic) => diagnostic.code);
}

describe.skipIf(!BROWSER_AVAILABLE)('reading components off a route that hydrates late', () => {
  it('waits for a shell that suspends mid-hydration, and names the component', async () => {
    // A part of the tree already carries a fiber while the root is still
    // dehydrated. A read that took that for a finished commit names nothing
    // for the `<p>`.
    const collected = await read(`${base}?hold=600`);

    expect(authorOfLate(collected)).toBe('Slow');
    expect(codes(collected)).toEqual([]);
  }, 120_000);

  it('finds the root on the Document an app hydrates whole', async () => {
    const collected = await read(`${base}whole.html?hold=600`);

    expect(authorOfLate(collected)).toBe('Slow');
    expect(codes(collected)).toEqual([]);
  }, 120_000);

  it('waits for as long as the response the shell holds on takes', async () => {
    // Past the two seconds a budget used to allow: nothing here decides how
    // long is too long but the page.
    const collected = await read(`${base}?hold=2500`);

    expect(authorOfLate(collected)).toBe('Slow');
    expect(codes(collected)).toEqual([]);
    expect(hydrationMs(collected)).toBeGreaterThanOrEqual(2_000);
  }, 120_000);

  it('refuses at once a route whose shell holds on something no response settles', async () => {
    const started = performance.now();
    const collected = await collect(`${base}?timer=60000`);

    expect(collected.ok).toBe(false);
    if (collected.ok) return;
    expect(collected.because).toMatch(/^`page\/app` stopped hydrating with 1 of 1 React root\(s\) uncommitted/);
    expect(collected.because).toMatch(/nothing the page requested was still arriving/);
    expect(performance.now() - started).toBeLessThan(30_000);
  }, 120_000);

  it('refuses at once beside a stream that stays open', async () => {
    // An event stream is a channel, not a response: it is open for as long as
    // the page is, and the shell is not waiting on it.
    const started = performance.now();
    const collected = await collect(`${base}?timer=60000&stream`);

    expect(collected.ok).toBe(false);
    if (collected.ok) return;
    expect(collected.because).toMatch(/nothing the page requested was still arriving/);
    expect(performance.now() - started).toBeLessThan(30_000);
  }, 120_000);

  it('stops waiting when the request it waited on fails', async () => {
    const started = performance.now();
    const collected = await collect(`${base}?timer=60000&fail=800`);

    expect(collected.ok).toBe(false);
    if (collected.ok) return;
    expect(collected.because).toMatch(/nothing the page requested was still arriving/);
    expect(performance.now() - started).toBeLessThan(30_000);
  }, 120_000);

  it('says no React root reached a route that has none', async () => {
    const collected = await read(`${base}static.html`);

    expect(authorOfLate(collected)).toBeUndefined();
    expect(codes(collected)).toEqual(['react-root-absent']);
  }, 120_000);

  it('reads a route React never loaded on once nothing is arriving', async () => {
    // Nothing is coming: the page loaded and no renderer introduced itself.
    const collected = await read(`${base}static.html`);

    expect(codes(collected)).toEqual(['react-root-absent']);
    expect(hydrationMs(collected)).toBeLessThan(1_000);
    expect(collected.diagnostics?.[0]?.message).toMatch(/React had not loaded on page\/app once nothing the page requested was still arriving/);
  }, 120_000);

  it('reads a route React never loaded on beside a request that never ends', async () => {
    // Only a script brings React; a long poll on a page without it is not one.
    const collected = await read(`${base}polling.html`);

    expect(codes(collected)).toEqual(['react-root-absent']);
    expect(hydrationMs(collected)).toBeLessThan(1_000);
  }, 120_000);

  it('says when the client changed the markup after the hydration commit', async () => {
    const collected = await read(`${base}flip.html?hold=600`, { ready: { 'page/app': '#app p' } });

    expect(codes(collected)).toEqual(['hydration-changed-markup']);
    const message = collected.diagnostics?.[0]?.message ?? '';
    expect(message).toMatch(/the hydration commit left `[^`]*early[^`]*` and the client then left `[^`]*client[^`]*`/);
    expect(message).toMatch(/Flip committed after hydrating/);
  }, 120_000);

  it('says nothing about React for a run that reads none', async () => {
    const collected = await read(`${base}static.html`, { wiring: false });

    expect(codes(collected)).toEqual([]);
  }, 120_000);
});
