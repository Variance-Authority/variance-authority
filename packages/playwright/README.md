<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/playwright

> A persistent Playwright harness and renderer for Variance Authority: one browser per run, documents turned into rasters.

**Variance Authority** is a visual regression toolkit for web interfaces: it
compares a rendered subject against an approved baseline and reports which
component caused each change. This package is one piece of it.

Use this package when your integration owns a browser harness or needs to turn a
`RenderDocument` into a raster. For an existing Playwright Test suite, start
with `@variance-authority/playwright-test`; for CLI route or
Storybook collection, use the corresponding collector. This lower-level package
does not choose subjects, mount application state, or build a page agent.

**Requires:** a browser **binary** on the machine, which an install does not give
you:

```bash
npm install --save-dev @variance-authority/playwright
npx playwright install chromium
```

This is the only box in the repository that will ever ask you to install a
browser. Everything downstream of a render — comparison, isolation, attribution,
storage — sits elsewhere and stays reachable without one.

Two tools live here — a persistent harness and a renderer — and they are separate
tools that happen to share that requirement. Beside them sit the wire's
observers: `observeNetwork` and its `freezeGif`, `blank*` and `fetchModules`
helpers, `unresizable`, and `captureOnce` for a single capture without standing
up a harness.

## Entrypoints

| entrypoint | holds | note |
|---|---|---|
| `.` | both tools | needs `playwright` |
| `playwright/renderer` | `createPlaywrightRenderer` | the renderer alone, without the harness |
| `playwright/agent` | `PageAgent`, `CaptureRequest`, `AGENT_GLOBAL` | **must not** need `playwright` — it is bundled into the page |

`playwright/agent` is the reason there are entrypoints at all. It is the page-side half,
injected into the browser as a classic script, and importing Playwright behind it
would put a node module in a bundle destined for a page.

## The harness: one Chromium, one page, one navigation

**A warm capture costs roughly a twenty-sixth of a cold one.** Measured over 48
renders, a capture into an already-open page took about 9 ms against about 233 ms
for one that launched a browser first. Absolute numbers depend on your machine;
the ratio is why the harness keeps one Chromium and one page for a whole run
instead of opening a browser per subject.

```ts
import { createHarness } from '@variance-authority/playwright';

// This is an application-owned classic-script bundle that installs a PageAgent
// at AGENT_GLOBAL. The package has no framework-specific agent to substitute.
const harness = await createHarness({
  url: 'file:///…/fixture.html',
  bundle: iifeBundleInstallingYourAgent,
  viewport: { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' },
});

const capture = await harness.capture('story:button--primary', 'after');
await harness.close();
```

The harness example is an adapter contract: `iifeBundleInstallingYourAgent`
must be a real IIFE string produced by your page integration. It is not an
export of this package. The bundle must install a `PageAgent` at `AGENT_GLOBAL`
and tear down the previous subject before each capture; if you do not own that
page-side code, use `@variance-authority/playwright-test` instead.

The harness carries **no knowledge of subjects, stories or frameworks**. The page
bundle supplies all of that through `PageAgent`, so the same harness serves a
fixture page, a Storybook, or a route. The agent owns subject teardown, because
the harness cannot: it does not know what the previous subject installed.

`capture` is sequential by contract. Two concurrent calls would render two
subjects into one document and let one decide the other's verdict.

`createHarness` takes:

| option | | what it decides |
|---|---|---|
| `url` | required | the page navigated once and reused |
| `bundle` | required | IIFE source installing a `PageAgent` at `AGENT_GLOBAL`. Not ESM: a module evaluates asynchronously, so the harness would poll instead of failing the moment the bundle is broken |
| `viewport` | required | width, height, scale, colour scheme |
| `fonts` | optional | families this capture is asserted to have; omitted means the capture says so |
| `features` | optional | environment facts recorded with the capture |
| `assets` | optional | asset digests recorded with the capture |
| `subjectId` | `fixture:<subject>` | how a subject name becomes a capture id |
| `headless` | `true` | set false to watch a case that is behaving oddly |
| `prepare` | none | run against the page *before* its first navigation. This is where `observeNetwork` attaches: a watcher installed after `goto` has already missed every asset the document pulled in, and the alternative pays a second page load per run to observe the first one |

`prepare` is a hook rather than a `network` option on purpose. The harness owns a
browser and nothing else; teaching it what an asset hash is would put a second
decision about the environment key in a file whose job is a page.

## The wire: what the page actually received

```ts
import {
  createHarness,
  observeNetwork,
  type NetworkObservation,
} from '@variance-authority/playwright';
import type { Viewport } from '@variance-authority/core';

declare const url: string;
declare const bundle: string;
declare const viewport: Viewport;

let network: NetworkObservation | undefined;
const harness = await createHarness({
  url,
  bundle,
  viewport,
  prepare: async (page) => {
    network = await observeNetwork(page);
  },
});
```

This is the axis nothing else in the category operates on, and it closes a false
`unchanged` a page cannot see about itself: a logo re-exported at the same URL is
the same markup, the same CSS and the same document — every tier settles and the
run reports that nothing moved, while the image is different bytes. Only the
party that saw the response knows otherwise.

| option | default | what it decides |
|---|---|---|
| `hashAssets` | `true` | fold asset bodies into the environment key. Off is a real position for a build whose URLs are content-addressed already: the URL is then the identity, and hashing the bytes again buys a read and nothing else |
| `hashCeilingBytes` | 8 MiB | above this an asset is recorded as `size:<n>` rather than by content. A ceiling, not a cliff — the weaker claim still moves the key when the file moves, and says in the value that it is weaker. Skipping it silently would leave a hole in the key, and a hole in this key is a false `unchanged` |
| `freezeAnimatedImages` | `true` | serve animated GIFs as their first frame. Done on the wire rather than in the page — see [`gif.ts`](src/gif.ts) |
| `blank` | none | `BlankRule[]`: images served as nothing, at their own size. The stronger relative of an ignore mask, and stronger because it happens *first* — a mask hides pixels after the page has fetched the image, laid out around it and moved the key with its bytes. It knows the URL and the intrinsic size, and does not know the DOM |
| `retainResources` | `false` | keep the bytes, not just the digest, so the document can be painted somewhere with no route to this origin. Retention rather than acquisition: every hashed body is already fetched and held long enough to digest, so a portable document costs a map and not a second crawl |

`retainResources` keeps **what was served** — the blank an image became, the
single frame a GIF was truncated to. Keeping what *arrived* would paint a
different picture later than the run that observed it, which is the one thing an
archive exists to prevent. `@variance-authority/route-collector`'s `portable: true`
is this option with a refusal on top.

`observeNetwork` returns a `NetworkObservation`: `assets` for the key, and
`frozen` and `blanked` as ledgers rather than counts — blanking is the one
intervention here that can hide a real regression, so an operator who blanked
more than they meant to can read back exactly what disappeared.

## Which engine paints

```ts
import { createPlaywrightRenderer } from '@variance-authority/playwright';

const safari = await createPlaywrightRenderer({ browser: 'webkit' });
```

`chromium` by default; `firefox` and `webkit` are the other two. The browser
binary is still the caller's to install — `npx playwright install webkit`.

**A second engine costs a second paint and nothing else.** A `RenderDocument` is
engine-independent, so it is collected once and rasterized per engine — which is
the whole difference from a category that prices coverage as
`tests × browsers × widths`, because there a browser produces the entire
observation.

**And no cross-engine rule was needed.** The engine was already in
`RenderIdentity`, which already keys the store, so a WebKit baseline lands in its
own directory and a Chromium run that finds it reports `incomparable` naming both.
The supplied stabilization recipe targets Chromium. Use `prepare` for any
engine-specific controls required by Firefox or WebKit.

## The renderer: a document in, a raster out

```ts
import { createPlaywrightRenderer } from '@variance-authority/playwright';

const renderer = await createPlaywrightRenderer();
const raster = await renderer.render(document);
```

Chromium launches with `--disable-lcd-text` and
`--font-render-hinting=none` by default. An explicit ordered `launchArgs` list
replaces that default. Headless mode and the ordered launch recipe are hashed
into `RenderIdentity.rasterization`, so changing font rasterization settings
partitions baselines instead of appearing as a product diff.

A resource-closed document is rendered without network access: archived
resource bytes satisfy matching requests and every unresolved request is
aborted. A document without a `resources` field remains a local, environment-
dependent input and may use the network available to the renderer.

**The viewport is not a renderer setting.** It arrives with each document, and
the renderer keeps one page per viewport and reuses it — so one renderer serves
1x and 2x, or a phone width and a desktop one, in the same run without a second
browser.

`createPlaywrightRenderer` takes:

| option | default | what it decides |
|---|---|---|
| `browser` | `chromium` | which engine paints. Part of `RenderIdentity` |
| `headless` | `true` | set false to watch a render |
| `launchArgs` | `CHROMIUM_RASTER_ARGS` on Chromium, none elsewhere | launch flags that may affect pixels. The exact ordered list is folded into the identity |
| `fonts` | none | what this machine is **asserted** to have, as `family/weight/style/hash`. A page can ask whether a family resolves and cannot read the bytes behind it, so this is a declaration — and it is what makes a baseline from a different font stack `incomparable` rather than `changed` |
| `waitForFonts` | `true` | wait on `document.fonts.ready` before painting |
| `stabilization` | `RASTER_RECIPE` | which tricks hold the page still. Folded into the identity, so a baseline made under one recipe and a run under another are `incomparable` |
| `assemble` | `AssembleOptions` defaults | how the document is turned into a page |
| `concurrency` | `1` | how many documents may be painted at once. Above 1 each render leases its own page, because `setContent` replaces a page's whole document. Worth having: the raster tier is where a run's time is |

It satisfies the `Renderer` contract from
`@variance-authority/raster` — the same one a renderer across a
network satisfies, which is what makes offloading a wiring decision made once at
the top rather than a rewrite.

It applies the stabilization recipe it is given, and reports conflicts rather
than resolving them.

## Page errors

A bundle that throws leaves the agent global undefined, and the failure would
otherwise surface as a timeout with no cause. Page-side errors are recorded and
reported, so `React is not defined` reads as `React is not defined`.

