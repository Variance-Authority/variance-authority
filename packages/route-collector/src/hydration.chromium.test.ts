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
 * Two answers are asserted, because a region with no component means different
 * things depending on why. A route React had not finished hydrating within the
 * budget is unobserved, and says so in a diagnostic. A route no React root
 * reached says that instead. A run that declared it reads no React
 * (`wiring: false`) says nothing, because it expected nothing.
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

/** How long the shell holds, from the query string, so one page serves every case. */
const MAIN = [
  "import { hydrateRoot } from 'react-dom/client';",
  "import { App } from './App.jsx';",
  "const hold = Number(new URLSearchParams(location.search).get('hold') ?? '0');",
  'const ready = new Promise((resolve) => setTimeout(resolve, hold));',
  "hydrateRoot(document.getElementById('root'), <App ready={ready} />);",
].join('\n');

/** The markup `App` renders, as the server sent it. */
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
  "const hold = Number(new URLSearchParams(location.search).get('hold') ?? '0');",
  'const ready = new Promise((resolve) => setTimeout(resolve, hold));',
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

/** The same markup with no client at all. */
const STATIC_HTML =
  '<!doctype html><html><body><main id="app"><span>early</span><p>late</p></main></body></html>';

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
  writeFileSync(join(root, 'src', 'App.jsx'), APP);
  writeFileSync(join(root, 'src', 'main.jsx'), MAIN);
  writeFileSync(join(root, 'whole.html'), WHOLE_HTML);
  writeFileSync(join(root, 'src', 'whole.jsx'), WHOLE);
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
  });
  await server.listen();

  await server.warmupRequest('/src/main.jsx');
  await server.warmupRequest('/src/App.jsx');
  await server.warmupRequest('/src/whole.jsx');
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

async function read(
  address: string,
  options: RouteCollectorOptions = {},
): Promise<Extract<Collected, { ok: true }>> {
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

  const collected = await collector.collect(PLAN.subjects[0]!);
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

  it('waits as long as `hydrationTimeoutMs` allows', async () => {
    const collected = await read(`${base}?hold=2500`, { hydrationTimeoutMs: 8_000 });

    expect(authorOfLate(collected)).toBe('Slow');
    expect(codes(collected)).toEqual([]);
  }, 120_000);

  it('says hydration was unfinished when the budget runs out', async () => {
    const collected = await read(`${base}?hold=60000`, { hydrationTimeoutMs: 500 });

    expect(authorOfLate(collected)).toBeUndefined();
    expect(codes(collected)).toEqual(['hydration-unfinished']);
  }, 120_000);

  it('says no React root reached a route that has none', async () => {
    const collected = await read(`${base}static.html`, { hydrationTimeoutMs: 300 });

    expect(authorOfLate(collected)).toBeUndefined();
    expect(codes(collected)).toEqual(['react-root-absent']);
  }, 120_000);

  it('says nothing about React for a run that reads none', async () => {
    const collected = await read(`${base}static.html`, { wiring: false });

    expect(codes(collected)).toEqual([]);
  }, 120_000);
});
