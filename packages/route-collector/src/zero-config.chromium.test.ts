import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SemanticNode, SourceLocation } from '@variance-authority/core';
import { routeCollector, type Collector, type Plan } from './index.js';

/**
 * **The claim, end to end: an application whose build knows nothing about this
 * project reports the line each element is written on.**
 *
 * Both routes this repository already ships for provenance ask the adopter for
 * something. `jsxImportSource` is a setting there is exactly one of, and a large
 * share of React projects have already spent it on Emotion. The plugin asks for
 * less — a resolver in `vite.config.js`, `jest.config.js` or `.storybook/main.js`
 * — but it is still an edit to the build that ships production code, made so
 * that a *test* can see more.
 *
 * So the fixtures are the assertion, and the two `vite.config.mjs` files below
 * should be read as the specification. Between them they contain one setting,
 * `jsx: 'automatic'`, which is how a React project says it is a React project;
 * one of them contains nothing at all. Neither names a plugin, a `jsxDev`, a
 * `jsxImportSource` or anything else belonging to Variance.
 *
 * What supplies the location instead is that React's development build captures
 * an `Error` inside its own element factory — true of every dev server there is
 * — and that the same dev server emits the source map that turns a frame in it
 * into a file.
 *
 * ## Why two of them
 *
 * They exercise different halves of React. The empty config leaves Vite on the
 * classic transform, so every element goes through `createElement` — the path a
 * JSX transform never touches, and the one a class component's `render` uses.
 * The automatic config reaches `jsxDEV`. A mechanism reading only the second
 * would work for most projects and silently return nothing for the first.
 *
 * The line numbers are load-bearing, and inserting a line above a marked element
 * is meant to fail this. Asserting that *some* line was reported would pass
 * while sending a reviewer to the wrong one.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * The component under observation, with its line numbers stated.
 *
 * Written as an array so the numbering lives in the file a reader is looking at
 * rather than in their head. `title` marks the elements because it survives
 * normalization and `data-testid` does not — the attribute allowlist admits what
 * a user can perceive, and a test hook is not that.
 */
function appSource(lead: readonly string[]): string {
  return [
    ...lead,
    /* +1 */ 'export function Badge({ label }) {',
    /* +2 */ '  return <span title="badge">{label}</span>;',
    /* +3 */ '}',
    /* +4 */ '',
    /* +5 */ 'export function App() {',
    /* +6 */ '  return (',
    /* +7 */ '    <main id="app">',
    /* +8 */ '      <section title="panel">',
    /* +9 */ '        <Badge label="ready" />',
    /* +10 */ '      </section>',
    /* +11 */ '    </main>',
    /* +12 */ '  );',
    /* +13 */ '}',
  ].join('\n');
}

/** Where each element is written, given how many lines precede the component. */
function writtenAt(lead: number): Record<'badge' | 'panel' | 'main', SourceLocation> {
  return {
    badge: { file: 'src/App.jsx', line: lead + 2, column: 10 },
    panel: { file: 'src/App.jsx', line: lead + 8, column: 7 },
    main: { file: 'src/App.jsx', line: lead + 7, column: 5 },
  };
}

const INDEX_HTML =
  '<!doctype html><html><body><div id="root"></div>' +
  '<script type="module" src="/src/main.jsx"></script></body></html>';

interface Fixture {
  readonly nodes: readonly SemanticNode[];
  readonly at: Record<'badge' | 'panel' | 'main', SourceLocation>;
}

const PLAN: Plan = {
  subjects: [{ subject: { id: 'page/app', kind: 'route' } }],
  notObserved: [],
  warnings: [],
};

const roots: string[] = [];
const servers: ViteDevServer[] = [];
const collectors: Collector[] = [];

/** Every node of a snapshot, in document order. */
function* walk(node: SemanticNode): Generator<SemanticNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

/**
 * A React application in a temporary directory, served and read once.
 *
 * The directory is `realpath`-ed before anything is written into it, because on
 * macOS `os.tmpdir()` is a symlink and Vite resolves its own root: leave the
 * unresolved path in place and every module the fixture serves is judged to be
 * outside the project it belongs to.
 */
async function build(config: string, lead: readonly string[]): Promise<Fixture> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'variance-zero-')));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });

  writeFileSync(join(root, 'index.html'), INDEX_HTML);
  writeFileSync(join(root, 'src', 'App.jsx'), appSource(lead));
  writeFileSync(
    join(root, 'src', 'main.jsx'),
    [
      ...lead,
      "import { createRoot } from 'react-dom/client';",
      "import { App } from './App.jsx';",
      "createRoot(document.getElementById('root')).render(<App />);",
    ].join('\n'),
  );
  writeFileSync(join(root, 'vite.config.mjs'), config);

  // React resolved from this repository's install, because a temporary directory
  // has none and running a package manager inside a test is not a test. A fact
  // about the fixture, not about the mechanism.
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'), 'dir');

  const server = await createServer({
    root,
    configFile: join(root, 'vite.config.mjs'),
    // Everything here belongs to the harness, not to the adopter: where to
    // listen, how loud to be, and where to keep prebundles so the run does not
    // write into this repository's `node_modules` through that symlink.
    // `fs.allow` is the symlink's consequence — React's real path is outside
    // this root, and Vite declines to serve outside it until told otherwise.
    server: { port: 0, host: '127.0.0.1', fs: { allow: [root, REPO] } },
    cacheDir: join(root, '.vite-cache'),
    logLevel: 'silent',
  });
  await server.listen();
  servers.push(server);

  // Warmed before a browser is pointed at it, because Vite discovers an
  // application's dependencies by transforming its modules and reloads the page
  // once it has prebundled them. A first load therefore navigates twice, and a
  // reader arriving mid-flight finds its execution context destroyed under it.
  // This is a fixture concern — a developer's dev server was warmed by the last
  // time they opened it — but a test that hits a cold one every run has to say
  // so somewhere, and this is the somewhere.
  await server.warmupRequest('/src/main.jsx');
  await server.warmupRequest('/src/App.jsx');
  await server.waitForRequestsIdle();

  const address = server.httpServer?.address();
  const port = address === null || address === undefined || typeof address === 'string' ? 0 : address.port;

  const collector = await routeCollector({
    routes: { 'page/app': `http://127.0.0.1:${port}/` },
    roots: ['#app'],
    ready: { 'page/app': '[title="badge"]' },
    readyTimeoutMs: 15_000,
  })({
    config: {
      viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
    },
    plan: PLAN,
  });
  collectors.push(collector);

  // Collected once. Every assertion below reads the same snapshot: they are
  // claims about one page load, and re-navigating per test would only establish
  // that the dev server is deterministic.
  const collected = await collector.collect(PLAN.subjects[0]!);
  if (!collected.ok) throw new Error(collected.because);
  if (collected.snapshot === undefined) throw new Error('collected no snapshot');

  return { nodes: [...walk(collected.snapshot.root)], at: writtenAt(lead.length) };
}

let classic: Fixture | undefined;
let automatic: Fixture | undefined;

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  // Nothing. Not a reduced config, not a config with the interesting parts
  // removed — the file a reviewer should open first.
  classic = await build('export default {};\n', ["import React from 'react';"]);

  // The one line, and the reason it is not a concession: `jsx: 'automatic'`
  // selects React's current element factory, which is what `@vitejs/plugin-react`
  // sets on an adopter's behalf and what every React toolchain since 2020 has
  // defaulted to. It says nothing about debugging, and nothing about this
  // project. Vite pairs it with the development runtime in serve mode by itself.
  automatic = await build("export default { esbuild: { jsx: 'automatic' } };\n", []);
}, 240_000);

afterAll(async () => {
  for (const collector of collectors) await collector.close();
  for (const server of servers) await server.close();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

// Announced at module scope, because that is the only place a reader of a
// skipped run sees anything: vitest's default reporter never prints a skipped
// test's name, and CI runs the default reporter.
if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/route-collector: zero-config provenance skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

function marked(fixture: Fixture, title: string): SemanticNode | undefined {
  return fixture.nodes.find((node) => node.attributes['title'] === title);
}

chromium_.each([
  ['an empty config, where JSX compiles to createElement', () => classic!],
  ['the automatic runtime, configured only as React', () => automatic!],
] as const)('%s', (_label, fixtureOf) => {
  it('reports the line and column an element is written on', () => {
    // The claim, byte-exact. Nothing in this build was arranged to produce it:
    // React's own captured error, resolved through the map Vite emits because
    // Vite emits maps.
    const fixture = fixtureOf();
    expect(marked(fixture, 'badge')?.provenance?.source).toEqual(fixture.at.badge);
  });

  it('names the element, not the component that returned it', () => {
    // `Badge` is declared a line above the `<span>` it returns. A reviewer sent
    // to the declaration still has to find the element, which is most of the
    // work the location was supposed to save.
    const fixture = fixtureOf();
    expect(marked(fixture, 'badge')?.provenance?.source?.line).toBe(fixture.at.badge.line);
  });

  it('separates two elements one component wrote', () => {
    // `<main>` and `<section>` come out of a single render of a single
    // component, one line apart. A mechanism resolving per component rather
    // than per element would give both the same line and look almost right.
    const fixture = fixtureOf();
    expect(marked(fixture, 'panel')?.provenance?.source).toEqual(fixture.at.panel);
    expect(fixture.nodes[0]?.tag).toBe('main');
    expect(fixture.nodes[0]?.provenance?.source).toEqual(fixture.at.main);
  });

  it('names a path a reviewer can open, with no origin in it', () => {
    // Not `http://127.0.0.1:5173/src/App.jsx`. A port is a fact about one run on
    // one machine, and a baseline holding one disagrees with the next.
    const file = marked(fixtureOf(), 'badge')?.provenance?.source?.file;
    expect(file).toBe('src/App.jsx');
    expect(file).not.toContain('127.0.0.1');
  });

  it('leaves no frames behind for anything downstream to hash', () => {
    // Frames are transient by construction. One surviving into a snapshot would
    // put an absolute URL with a port in it inside a render hash, and every
    // baseline would disagree with the next dev-server restart.
    for (const node of fixtureOf().nodes) expect(node.provenance?.stack).toBeUndefined();
  });

  it('locates every element it captured, not a lucky one', () => {
    // A floor over the whole subtree rather than over the three nodes this suite
    // names, so a mechanism that happened to work for those and failed for their
    // siblings would still be caught.
    const { nodes } = fixtureOf();
    expect(nodes.filter((node) => node.provenance?.source !== undefined)).toHaveLength(nodes.length);
  });
});
