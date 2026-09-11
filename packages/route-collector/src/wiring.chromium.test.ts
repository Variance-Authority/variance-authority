import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SemanticNode } from '@variance-authority/core/format';
import { routeCollector, type Collector, type Plan, type RouteCollectorOptions } from './index.js';

/**
 * Two readers `collect` accepts, reachable from the option an operator writes.
 *
 * `wiringOf` and `holdingOf` are injection points on `CollectOptions`, and until
 * this suite existed no shipped collector passed either: the band a project
 * would key a component on was absent from every run this package produced, and
 * the only way to obtain one was to write a page agent. That is the failure the
 * assertions below are aimed at — not whether React's fiber can be read, which
 * `@variance-authority/react` establishes against React itself, but whether an
 * option in a config reaches the reader.
 *
 * **The defaults are the other half of the claim.** Wiring is on because turning
 * it on moves no stored digest — it is a band of its own, outside the component
 * hash and outside `structureHash` — so a project that never asked for it loses
 * nothing by receiving it. A holding is off because reading one *does* move a
 * structure: a node carrying a holding survives the inert-wrapper collapse, so
 * the same page read both ways produces two different `structureHash`es, and
 * defaulting that on would silently re-baseline everyone.
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
    '\npackages/route-collector (wiring): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * One component with something to say in every field the two types carry: a
 * prop, a hook cell that retains a value, and a context subscription. A
 * component with none of them would pass an assertion about *presence* while the
 * band it produced was empty.
 */
const APP = `import { createContext, useContext, useState } from 'react';

const Theme = createContext('dark');
Theme.displayName = 'Theme';

export function Badge({ label }) {
  const [count] = useState(1);
  const theme = useContext(Theme);
  return <span title="badge">{label} {count} {theme}</span>;
}

export function App() {
  return (
    <main id="app">
      <Theme.Provider value="dark">
        <Badge label="ready" />
      </Theme.Provider>
    </main>
  );
}
`;

const INDEX_HTML =
  '<!doctype html><html><body><div id="root"></div>' +
  '<script type="module" src="/src/main.jsx"></script></body></html>';

const PLAN: Plan = {
  subjects: [{ subject: { id: 'page/app', kind: 'route' } }],
  notObserved: [],
  warnings: [],
};

const roots: string[] = [];
const collectors: Collector[] = [];
let server: ViteDevServer | undefined;
let base = '';

/** Every node of a snapshot, in document order. */
function* walk(node: SemanticNode): Generator<SemanticNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

/**
 * The dev server is built the way `zero-config.chromium.test.ts` builds its
 * own — `realpath` first because macOS's `tmpdir()` is a symlink and Vite
 * resolves its own root, `node_modules` symlinked because a temporary directory
 * has no React and running a package manager inside a test is not a test.
 */
beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  const root = realpathSync(mkdtempSync(join(tmpdir(), 'variance-wiring-')));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });

  writeFileSync(join(root, 'index.html'), INDEX_HTML);
  writeFileSync(join(root, 'src', 'App.jsx'), APP);
  writeFileSync(
    join(root, 'src', 'main.jsx'),
    [
      "import { createRoot } from 'react-dom/client';",
      "import { App } from './App.jsx';",
      "createRoot(document.getElementById('root')).render(<App />);",
    ].join('\n'),
  );
  writeFileSync(join(root, 'vite.config.mjs'), "export default { esbuild: { jsx: 'automatic' } };\n");
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'), 'dir');

  server = await createServer({
    root,
    configFile: join(root, 'vite.config.mjs'),
    server: { port: 0, host: '127.0.0.1', fs: { allow: [root, REPO] } },
    cacheDir: join(root, '.vite-cache'),
    logLevel: 'silent',
  });
  await server.listen();

  // Warmed before a browser arrives: Vite reloads the page once it has
  // prebundled an application's dependencies, and a reader arriving mid-flight
  // finds its execution context destroyed under it.
  await server.warmupRequest('/src/main.jsx');
  await server.warmupRequest('/src/App.jsx');
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

async function nodesFor(options: RouteCollectorOptions = {}): Promise<readonly SemanticNode[]> {
  const collector = await routeCollector({
    routes: { 'page/app': base },
    roots: ['#app'],
    ready: { 'page/app': '[title="badge"]' },
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
  if (collected.snapshot === undefined) throw new Error('collected no snapshot');
  return [...walk(collected.snapshot.root)];
}

// Outside the gate on purpose: a todo inside a browser-gated `describe` is
// reported as skipped, so the gap would disappear from the count on exactly the
// machines running least of the suite.
it.todo(
  'a snapshot says whether holdings were read — needs a recorded reading mode, ' +
    'because a holding suppresses the wrapper collapse and moves `structureHash` ' +
    'with nothing in the reading to say which way it was read',
);

describe.skipIf(!BROWSER_AVAILABLE)('what a collected node carries about its component', () => {
  it('carries wiring without being asked, and carries its content', async () => {
    const nodes = await nodesFor();
    const wired = nodes.filter((node) => node.wiring !== undefined);

    // Content, never presence. The dangerous failure here is a band that arrives
    // empty: two components with different hook shapes then hash identically and
    // the band reports that nothing changed.
    expect(wired.length).toBeGreaterThan(0);
    const badge = wired.find((node) => node.wiring?.contexts?.includes('Theme'));
    expect(badge?.wiring?.hooks).toEqual(['useState', 'useContext']);
  }, 120_000);

  it('leaves wiring out for `wiring: false`', async () => {
    // Absent, not empty. A page with no framework adapter and a run that
    // declined the walk should look the same to a differ (ADR-0002).
    const nodes = await nodesFor({ wiring: false });

    expect(nodes.filter((node) => node.wiring !== undefined)).toEqual([]);
  }, 120_000);

  it('reads no holding until a run asks for one', async () => {
    // The asymmetry with wiring, asserted rather than described. A holding
    // suppresses the inert-wrapper collapse, so a default-on holding would move
    // `structureHash` for every project that never asked for evidence.
    const nodes = await nodesFor();

    expect(nodes.filter((node) => node.holding !== undefined)).toEqual([]);
  }, 120_000);

  it('reads one for `holdings: true`, digests only', async () => {
    const nodes = await nodesFor({ holdings: true });
    const held = nodes.filter((node) => node.holding !== undefined);

    expect(held.length).toBeGreaterThan(0);
    const badge = held.find((node) => node.holding?.props?.some((prop) => prop.name === 'label'));
    expect(badge?.holding?.props?.map((prop) => prop.name)).toEqual(['label']);
    expect(badge?.holding?.cells?.map((cell) => cell.hook)).toEqual(['useState']);
    // Beside the cells rather than among them: a `useContext` leaves no hook
    // cell, so a reader that only walked `cells` would report a component whose
    // provider moved as having read nothing.
    expect(badge?.holding?.contexts?.map((held) => held.name)).toEqual(['Theme']);
    // Digests, never values. `ready` is a prop this page renders and nothing
    // that travels off it may be reversible into what a user was looking at.
    for (const prop of badge?.holding?.props ?? []) expect(prop.digest).toMatch(/^v1:[0-9a-f]{32}$/);
  }, 120_000);
});
