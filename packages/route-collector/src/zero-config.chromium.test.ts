import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { locateSites, type LocatableSite } from '@variance-authority/core/attribute';
import type { SemanticNode, SourceLocation } from '@variance-authority/core/format';
import { routeCollector, type Collector } from './index.js';
import { appSource, INDEX_HTML, PLAN, REACT_18, writtenAt, type Fixture } from './zero-config.fixture.js';

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
 * `runtime: 'classic'`, which is how a project stays on the transform it has;
 * the other contains nothing at all. Neither names a plugin, a `jsxDev`, a
 * `jsxImportSource` or anything else belonging to Variance.
 *
 * What supplies the location instead is that React's development build captures
 * an `Error` inside its own element factory — true of every dev server there is
 * — and that the same dev server emits the source map that turns a frame in it
 * into a file.
 *
 * ## Why several of them
 *
 * They exercise different halves of React, and two major versions of it.
 *
 * The classic config sends every element through `createElement` — the path a
 * JSX transform never touches, and the one a class component's `render` uses.
 * The empty config leaves Vite on the automatic runtime, which reaches `jsxDEV`.
 * A mechanism reading only the second would work for most projects and silently
 * return nothing for the first.
 *
 * **React 18 arrives at the same answer down a different road, and it is the
 * cheaper one.** React ≤18 keeps the transform's own `{fileName, lineNumber,
 * columnNumber}` on the fiber as `_debugSource`, so the location is computed by
 * the compiler and needs no stack, no module fetch and no source map. React 19
 * removed that field and captures an `Error` instead, which is what everything
 * about frames and maps exists to spend. Both are read, `_debugSource` first,
 * and neither version is asked to be the other.
 *
 * The line numbers are load-bearing, and inserting a line above a marked element
 * is meant to fail this. Asserting that *some* line was reported would pass
 * while sending a reviewer to the wrong one.
 *
 * ## The location is asked for, and that is asserted too
 *
 * A collected snapshot does not carry React 19's answer: resolving a frame means
 * fetching a module, and a suite where every subject settles has nobody to hand
 * a location to. The frames ride unspent and the tests below go through
 * `locateSites` for an answer, which is what the report does — including one
 * that measures asking about a single element at a single call site.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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
async function build(config: string, lead: readonly string[], react: 18 | 19): Promise<Fixture> {
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

  // The two versions name the same line in two spellings, and the difference is
  // not cosmetic. React 19's answer comes out of a source map, whose `sources`
  // resolve against the URL the browser was served, so it is already relative to
  // the served root. React 18's is the compiler's own `fileName`, which every
  // bundler writes absolute — made repository-relative during normalization
  // against the run's root, which for a real project is where both the dev
  // server and the run start, and which for a temporary directory is not.
  const file = react === 19 ? 'src/App.jsx' : join(root, 'src', 'App.jsx');

  if (collector.callSites === undefined) throw new Error('the collector offered no resolver');

  return {
    nodes: [...walk(collected.snapshot.root)],
    snapshot: collected.snapshot,
    callSites: collector.callSites,
    carries: react === 19 ? 'stack' : 'source',
    at: writtenAt(lead.length, file),
  };
}

let classic: Fixture | undefined;
let automatic: Fixture | undefined;
let automatic18: Fixture | undefined;
let classic18: Fixture | undefined;
let unmarked18: Fixture | undefined;

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  // The one line, and the reason it is not a concession: `runtime: 'classic'`
  // keeps a project on `createElement`, the transform it was written against.
  // It says nothing about debugging, and nothing about this project.
  classic = await build("export default { oxc: { jsx: { runtime: 'classic' } } };\n", ["import React from 'react';"], 19);

  // Nothing. Not a reduced config, not a config with the interesting parts
  // removed — the file a reviewer should open first. Vite's own default selects
  // React's current element factory, and pairs it with the development runtime
  // in serve mode by itself.
  automatic = await build('export default {};\n', [], 19);

  // The same nothing, against the React the majority of installed applications
  // are still on. Nothing else differs, and nothing in this repository selects a
  // path by version number: `_debugSource` is read first because a location the
  // compiler already computed beats one that has to be resolved, and React 19
  // simply has none.
  automatic18 = await build(`export default {\n${REACT_18}};\n`, [], 18);

  // The classic line against React 18. Serving development, Vite writes
  // `__source` into `createElement` calls too, so `_debugSource` is filled here
  // by the same road.
  classic18 = await build(
    `export default {\n  oxc: { jsx: { runtime: 'classic' } },\n${REACT_18}};\n`,
    ["import React from 'react';"],
    18,
  );

  // The corner with no answer in it, built so the claim above stays exact.
  unmarked18 = await build(
    `export default {\n  oxc: { jsx: { runtime: 'classic', development: false } },\n${REACT_18}};\n`,
    ["import React from 'react';"],
    18,
  );
}, 480_000);

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

/**
 * A node as the report would hand it over: its path, and what the build already
 * knew.
 *
 * This is what an `AttributedRegion` and a `Finding` both are by the time they
 * reach `locateSites` — attribution copies a recorded `provenance.source` onto
 * the region — which is why React 18 arrives answered and React 19 arrives
 * asking.
 */
function siteOf(node: SemanticNode): LocatableSite {
  return {
    path: node.path,
    ...(node.provenance?.source !== undefined ? { source: node.provenance.source } : {}),
  };
}

/** What a report asking about one element would print for it. */
async function sourceOf(fixture: Fixture, title: string): Promise<SourceLocation | undefined> {
  const node = marked(fixture, title);
  if (node === undefined) return undefined;

  const [located] = await locateSites([siteOf(node)], fixture.snapshot, fixture.callSites);
  return located?.source;
}

chromium_.each([
  ['React 19, the classic transform, where JSX compiles to createElement', () => classic!],
  ['React 19, an empty config, on the automatic runtime', () => automatic!],
  ['React 18, configured only as React 18, on the automatic runtime', () => automatic18!],
  ['React 18, the classic transform, which writes `__source` when serving development', () => classic18!],
] as const)('%s', (_label, fixtureOf) => {
  it('reports the line and column an element is written on', async () => {
    // The claim, byte-exact. Nothing in this build was arranged to produce it:
    // React's own captured error, resolved through the map Vite emits because
    // Vite emits maps.
    const fixture = fixtureOf();
    expect(await sourceOf(fixture, 'badge')).toEqual(fixture.at.badge);
  });

  it('names the element, not the component that returned it', async () => {
    // `Badge` is declared a line above the `<span>` it returns. A reviewer sent
    // to the declaration still has to find the element, which is most of the
    // work the location was supposed to save.
    const fixture = fixtureOf();
    expect((await sourceOf(fixture, 'badge'))?.line).toBe(fixture.at.badge.line);
  });

  it('separates two elements one component wrote', async () => {
    // `<main>` and `<section>` come out of a single render of a single
    // component, one line apart. A mechanism resolving per component rather
    // than per element would give both the same line and look almost right.
    const fixture = fixtureOf();
    expect(await sourceOf(fixture, 'panel')).toEqual(fixture.at.panel);

    const root = fixture.nodes[0]!;
    expect(root.tag).toBe('main');
    const [located] = await locateSites([siteOf(root)], fixture.snapshot, fixture.callSites);
    expect(located?.source).toEqual(fixture.at.main);
  });

  it('names a path a reviewer can open, with no origin in it', async () => {
    // Not `http://127.0.0.1:5173/src/App.jsx`. A port is a fact about one run on
    // one machine, and a baseline holding one disagrees with the next. Which
    // path it is differs by version and is asserted with the rest of the
    // location; what may never differ is that a URL survived into it.
    const file = (await sourceOf(fixtureOf(), 'badge'))?.file;
    expect(file).toMatch(/src\/App\.jsx$/);
    expect(file).not.toContain('127.0.0.1');
    expect(file).not.toContain('http');
  });

  it('carries what the build gave it, and resolves nothing on its own', () => {
    // Neither version has been spent. React 18's location was computed by the
    // compiler, so a capture that asks nothing still has it; React 19's is a
    // module fetch away, and a run whose subjects all settle makes none.
    const fixture = fixtureOf();
    const badge = marked(fixture, 'badge');

    if (fixture.carries === 'source') {
      expect(badge?.provenance?.source).toEqual(fixture.at.badge);
      expect(badge?.provenance?.stack).toBeUndefined();
      return;
    }

    expect(badge?.provenance?.source).toBeUndefined();
    expect(badge?.provenance?.stack?.length).toBeGreaterThan(0);
  });

  it('spends one call site to answer about one element', async () => {
    // The economy, measured rather than described: asking about a single node
    // resolves a single site, not the subtree it belongs to.
    const fixture = fixtureOf();
    const before = fixture.callSites.stats.sites;

    await sourceOf(fixture, 'badge');

    expect(fixture.callSites.stats.sites - before).toBeLessThanOrEqual(1);
  });

  it('locates every element it captured, not a lucky one', async () => {
    // A floor over the whole subtree rather than the three nodes this suite
    // names, so a mechanism that worked for those and failed for their siblings
    // is still caught. It is also the shape a heavily-changed subject arrives
    // in, and the resolver's cache is what keeps it to a handful of fetches.
    const { nodes, snapshot, callSites } = fixtureOf();
    const located = await locateSites(nodes.map(siteOf), snapshot, callSites);

    expect(located.filter((site) => site.source !== undefined)).toHaveLength(nodes.length);
  });
});

/**
 * Frames ride the snapshot, and nothing downstream can see them.
 *
 * This is what makes deferral safe rather than merely cheap: a frame holds a dev
 * server's port, so a snapshot carrying one would disagree with the next restart
 * if anything hashed it. Nothing does — the projections a hash is folded from
 * are whitelists, and provenance is not on them.
 *
 * Asserted across two fixtures rather than by reading a hash, because this is
 * the observable form of the claim. Same JSX, same DOM, same one line of config,
 * and two captures in genuinely different states. Equal hashes are the only
 * outcome consistent with neither state being read.
 */
chromium_('a frame changes no hash', () => {
  it('hashes the same tree identically whether it carries frames or a location', () => {
    const withFrames = automatic!.nodes[0]!;
    const withSource = automatic18!.nodes[0]!;

    expect(withFrames.provenance?.stack?.length).toBeGreaterThan(0);
    expect(withSource.provenance?.source).toBeDefined();

    expect(withFrames.renderHash).toBe(withSource.renderHash);
    expect(withFrames.structureHash).toBe(withSource.structureHash);
    expect(withFrames.styleHash).toBe(withSource.styleHash);
  });
});

/**
 * The one combination that has no location in it, asserted so the claim above
 * cannot quietly grow.
 *
 * React 18 with classic output and no development emission: `createElement` is
 * called with a props object the compiler wrote no `__source` into, and React 18
 * captures no error of its own to make up the difference. Nothing is lost by this
 * that was ever present; there is simply nothing to read.
 *
 * It is a narrow corner. Reaching it means being on React 18, declining the
 * transform React has defaulted to since 2020, *and* turning off what Vite turns
 * on when serving development. Naming it here is cheaper than letting a reader
 * infer from two passing versions that every combination of them passes.
 */
chromium_('React 18 with no `__source` in classic output reports no location, and says so by absence', () => {
  it('captures the elements but attributes none of them', async () => {
    const { nodes, snapshot, callSites } = unmarked18!;
    expect(nodes.length).toBeGreaterThan(2);

    // Asked properly, not just inspected. Nothing is recorded and nothing is
    // resolvable, so the demand side answers with the sites it was handed.
    const located = await locateSites(nodes.map(siteOf), snapshot, callSites);
    expect(located.filter((site) => site.source !== undefined)).toHaveLength(0);
  });

  it('still names the components that wrote them', () => {
    // The fallback is not nothing. Owners come off the fiber whatever the
    // transform did, so a report keeps `Badge` and loses only its line.
    const badge = unmarked18!.nodes.find((node) => node.attributes['title'] === 'badge');
    expect(badge?.provenance?.owners.map((owner) => owner.name)).toContain('Badge');
  });
});
