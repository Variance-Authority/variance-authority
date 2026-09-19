<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/playwright

> A persistent Playwright harness and renderer for Variance Authority: one browser per run, documents turned into rasters.

Part of [Variance Authority](https://variance-authority.dev).

## What this package does

It is the browser half of the system, and nothing else. Two tools live here:

- a **harness** — one Chromium, one page, one navigation, and a capture per
  subject obtained by calling into that page. A **subject** is one named UI
  state you asked for and can ask for again, such as `cart/empty`.
- a **renderer** — a `RenderDocument` in, a PNG plus the conditions it was
  captured under out, without keeping a browser open across calls.

Beside them sit the network observers (`observeNetwork`, `freezeGif`, the
`blank*` helpers, `fetchModules`), `unresizable`, and `captureOnce` for a single
capture with no harness standing.

**Reach for this package when you are writing the integration**, not when you
are writing tests. It does not choose subjects, mount application state, or
build the page-side agent; you supply that. If you already have a Playwright
Test suite, install `@variance-authority/playwright-test` instead. For a CLI
route or a Storybook collection, use the corresponding collector.

## Install

Playwright's browser binaries do not arrive with an `npm install`, so there are
two commands rather than one:

```bash
npm install --save-dev @variance-authority/playwright
npx playwright install chromium
```

The package depends on `playwright ^1.49.0` and installs it for you, so you
supply only the browser binaries. Node 22 or newer. The engine and container
figures further down were taken on Playwright 1.62.1.

Installing a browser is what this package is for. Comparison, isolation,
attribution and storage live in other packages and need no browser.

## A capture, end to end

This runs as written. The bundle is a classic-script IIFE that installs a
`PageAgent` at `AGENT_GLOBAL` — the object the harness calls to read a subject —
and the one here is a stub that reports a rectangle, so you can see the
round trip before you have an application-side bundle.

```js
import { createHarness } from '@variance-authority/playwright';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';

const bundle = `
(() => {
  window[${JSON.stringify(AGENT_GLOBAL)}] = {
    capture(request) {
      const host = document.createElement('div');
      host.textContent = request.subject + '/' + request.variant;
      document.body.appendChild(host);
      const rect = host.getBoundingClientRect();
      host.remove();
      return JSON.stringify({
        captureVersion: 1,
        subject: { id: request.subjectId, kind: 'fixture' },
        profile: { id: 'chromium', ariaTree: true, declaredStyle: true, computedStyle: true, layout: true, raster: true },
        environment: {
          profile: 'chromium',
          engine: request.engine,
          viewport: request.viewport,
          fonts: request.fonts ?? [],
          conditions: {},
          assets: {},
        },
        root: { tag: 'div', attributes: {}, matchedRules: [], rect, children: [] },
        inheritedSeed: {},
        diagnostics: [],
      });
    },
  };
})();
`;

const harness = await createHarness({
  url: 'about:blank',
  bundle,
  viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
});

const capture = await harness.capture('button', 'primary');
console.log(capture.subject.id, capture.environment.engine, capture.root.rect.width);
await harness.close();
```

```
fixture:button chromium@151.0.7922.34 784
```

Your own bundle replaces the stub: it reads the real subject, serializes a
`RawCapture`, and tears the previous subject down before each capture. The
harness cannot do that teardown — it does not know what the previous subject
installed. If you do not own page-side code of that kind, use
`@variance-authority/playwright-test`.

`capture` returns a JSON **string** from the page, which the harness parses. A
capture that acquires a `Map`, a DOM handle or a cycle fails here rather than
three transports later.

## Entrypoints

| entrypoint | holds | note |
|---|---|---|
| `.` | the harness and the network observation | needs `playwright` |
| `@variance-authority/playwright/renderer` | `createPlaywrightRenderer` | the renderer alone, without the harness |
| `@variance-authority/playwright/agent` | `PageAgent`, `CaptureRequest`, `AGENT_GLOBAL` | **must not** need `playwright` — it is bundled into the page |
| `@variance-authority/playwright/engines` | `declaredEngines`, `requireEngines`, `engineStatus` | which engines a run is asked to use, and whether this machine has them |

`playwright/agent` is published separately because it runs inside the browser:
it is injected as a classic script, and importing Playwright behind it would put
a Node module in a bundle destined for a page.

## The harness: one Chromium, one page, one navigation

The harness keeps one browser and one page for a whole run and switches subjects
by calling into the page. `captureOnce` is the same code with nothing reused —
launch, navigate, inject, collect, close — and it ships so that the comparison
measures one capture path on both sides. Over 48 distinct `(subject, variant)`
renders on an Apple-silicon Mac with `chromium@151.0.7922.34`, the reused page
cost **7.5 ms a capture against 205 ms** when each capture launched a browser
first: 27x, reproduced across three runs. Absolute numbers move with the
machine; the ratio is the reason for the shape.

The harness carries no knowledge of subjects, stories or frameworks, so the same
harness serves a fixture page, a Storybook, or a route.

`capture` is sequential by contract. Two concurrent calls would render two
subjects into one document and let one decide the other's verdict.

`createHarness` takes:

| option | default | what it decides |
|---|---|---|
| `url` | required | the page navigated once and reused. `file://` is fine and needs no server |
| `bundle` | required | IIFE source installing a `PageAgent` at `AGENT_GLOBAL`. Not ESM: a module evaluates asynchronously, so the harness would poll instead of failing the moment the bundle is broken |
| `viewport` | required | width, height, scale, colour scheme |
| `fonts` | optional | families this capture is asserted to have; when it is omitted the capture records that nothing was asserted |
| `features` | optional | environment facts recorded with the capture |
| `assets` | optional | asset digests recorded with the capture |
| `subjectId` | `fixture:<subject>` | how a subject name becomes a capture id |
| `headless` | `true` | set false to watch a case that is behaving oddly |
| `prepare` | none | run against the page *before* its first navigation. This is where `observeNetwork` attaches: a watcher installed after `goto` has already missed every asset the document pulled in, and the alternative pays a second page load per run to observe the first one |

`prepare` is a hook rather than a `network` option: the harness only owns the
browser, so decisions about the environment key — like asset hashing — stay in
the page, not the harness.

## What the page was actually served

`observeNetwork` watches every request a page's navigation makes and returns a
`NetworkObservation`: which assets were seen, and — per the options below —
which of them were frozen or blanked before they reached the page.

```ts
import {
  createHarness,
  observeNetwork,
  type NetworkObservation,
} from '@variance-authority/playwright';
import type { Viewport } from '@variance-authority/core/format';

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

This closes a false `unchanged` a page cannot see about itself: a logo
re-exported at the same URL is the same markup, the same CSS and the same
document, so every comparison tier — DOM, CSS, layout — settles and the run
reports that nothing changed, even though the served image is different bytes.
Only the party that watched the network response knows otherwise.

| option | default | what it decides |
|---|---|---|
| `hashAssets` | `true` | fold asset bodies into the environment key. Off is a real position for a build whose URLs are content-addressed already: the URL is then the identity, and hashing the bytes again buys a read and nothing else |
| `hashCeilingBytes` | 8 MiB | above this an asset is recorded as `size:<n>` rather than by content. A ceiling, not a cliff — the weaker claim still changes the key when the file changes, and says in the value that it is weaker. Skipping it silently would leave a hole in the key, and a hole in this key is a false `unchanged` |
| `freezeAnimatedImages` | `true` | serve animated GIFs as their first frame, on the wire rather than in the page |
| `blank` | none | `BlankRule[]`: images served as nothing, at their own size. The stronger relative of an ignore mask, and stronger because it happens *first* — a mask hides pixels after the page has fetched the image, laid out around it and folded its bytes into the key. It knows the URL and the intrinsic size, and does not know the DOM |
| `retainResources` | `false` | keep the bytes, not just the digest, so the document can be painted somewhere with no route to this origin. Retention rather than acquisition: every hashed body is already fetched and held long enough to digest, so a portable document costs a map and not a second crawl |

`retainResources` keeps **what was served** — the blank an image became, the
single frame a GIF was truncated to. Keeping what *arrived* would paint a
different picture later than the run that observed it, which is the one thing an
archive exists to prevent.

`assets` is the map folded into the environment key. `frozen` and `blanked` are
ledgers rather than counts — blanking is the one intervention here that can hide
a real regression, so an operator who blanked more than they meant to can read
back exactly what disappeared.

## Where a component is declared, asked of the engine

A source scan answers a name: every declaration in the configured directories
that spells `Button`, and when two do, the name is ambiguous and the report says
so. The page holds something better than a name. The fiber carries the function
React called, and V8 knows where every function it compiled begins. So the page
agent keeps the functions it met, and `createDeclarationReader(page)` asks
Chromium over CDP for each one's `[[FunctionLocation]]`, then maps the position
through the served module's source map to a repository file and line.

Excerpt — `page` is `harness.page`, `scanned` is the `SourceIndex` your scan
produced, and `overlaySourceIndex` comes from
`@variance-authority/core/attribute`:

```ts
import { createDeclarationReader } from '@variance-authority/playwright';
import { overlaySourceIndex } from '@variance-authority/core/attribute';

const declared = createDeclarationReader(page);
// ...after the agent has read a subject...
const engine = await declared.read(); // SourceIndex, every ref `via: 'engine'`
const source = overlaySourceIndex(scanned, engine);
await declared.close();
```

`read()` is incremental: the registry in the page only grows, each read asks
about what is new and returns the union, and a registry rebuilt by a navigation
starts the count over. `stats` counts what was asked and what mapped to a file
the project wrote; the vendor rule is the call-site resolver's, so a component
declared in `node_modules` is not an answer.

Chromium only. On WebKit and Firefox `newCDPSession` throws, the reader notes it
once, and `read()` answers the empty index for the rest of the page's life.
Nothing downstream tells that from a page with no components, and the scan still
stands underneath.

Options: `global` names the global the agent is installed at, `AGENT_GLOBAL`
unless the bundle chose another. `fetchModule` supplies the fetch for served
modules and their maps, from inside the page unless told otherwise. `root` is the
path an answer is made relative to, the working directory unless told otherwise.

## Which engine paints

```ts
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';

const safari = await createPlaywrightRenderer({ browser: 'webkit' });
```

`chromium` by default, `webkit` the other declared engine. The browser binary is
still yours to install — `npx playwright install webkit`. `firefox` is accepted
by the renderer but is not declared; see below.

### A run measures what it declares

Anything that paints in more than one engine takes its list from
`playwright/engines` rather than from whatever is installed:

```ts
import { declaredEngines, requireEngines } from '@variance-authority/playwright/engines';

const engines = requireEngines(declaredEngines()); // ['chromium', 'webkit']
```

`requireEngines` throws and names the engine when a declared one is not
installed, because the alternative is a result that changes with the machine: a
laptop missing WebKit measures one engine, reports green, and says nothing about
the claim it did not check. On a machine with Chromium and no WebKit, that throw
reads:

```
declared engine not installed: webkit (this machine has chromium)
  npx playwright install webkit
  (the list is DECLARED_ENGINES in packages/playwright/src/engines.ts; VARIANCE_ENGINES overrides it)
```

A machine with no browsers at all returns empty, which is the one case a caller
may skip on.

`VARIANCE_ENGINES=chromium,webkit` overrides the list for a single run. It
changes what is asked for, not the rule — whatever it names still has to exist.

A `RenderDocument` is engine-independent, so **a second engine costs a second
paint and no second collection**. What that paint costs differs sharply by
engine and by subject; the table below is the size of it.

The engine is part of `RenderIdentity`, which keys the baseline store: a WebKit
baseline lands in its own directory, and a Chromium run that finds one reports
`incomparable`, naming both engines. The supplied stabilization recipe targets
Chromium — use `prepare` for engine-specific controls needed by Firefox or
WebKit.

### Only Chromium can be told how to paint text

`CHROMIUM_RASTER_ARGS` — `--disable-lcd-text`, `--font-render-hinting=none` —
makes Chromium's text independent of host defaults, and there is no equivalent
for Firefox or WebKit. Their text is painted the way the host paints text.
WebKit's one lever is the page's own `-webkit-font-smoothing`, which is not a
substitute: it changes 4,204 pixels of a 500x160 subject, so it changes the
subject rather than the conditions the subject is photographed under.

On macOS none of this bites. The system has had no subpixel antialiasing since
10.14, all four candidate flags are no-ops, and every engine paints greyscale
headed or headless at 1x and 2x. Where fontconfig is live — Linux, so most CI —
the flags are load-bearing for Chromium and absent for the other two. Measured in
`mcr.microsoft.com/playwright:v1.62.1-noble`: Chromium painting a webfont emits
6,662 chromatic pixels, the two flags take that to zero, and Firefox and WebKit
are unaffected because the flags never reached them.

**So a WebKit or Firefox raster is comparable only to one from the same host.**
`RenderIdentity` carries `platform`, so a laptop's baseline and a container's are
separate baselines and a run says `incomparable` rather than comparing them. That
is the safe failure, not a solution: neither answers for the other. If rasters are
produced in a container, produce them only there — a local WebKit renderer records
baselines nothing will ever compare against, and pays the raster tier for them.
The semantic tier is unaffected and stays local.

The container is cheap, which is not what people assume. Measured on an Apple M4
Max (16 cores, 64 GB) under Docker Desktop 29.0.1 with Playwright 1.62.1,
`mcr.microsoft.com/playwright:v1.62.1-noble` costs WebKit 1.66x per paint against
native macOS and Chromium roughly 1.1x — the least repeatable of the three cells,
and not worth quoting to two figures. Firefox it costs nothing at all: Firefox is
*faster* in the container, 7.5 ms against 8.3. The same image run as arm64 and as
translated amd64 produces byte-identical rasters, so the pixels follow the image
rather than the machine.

The engine outranks both the host and the emulator: across those three hosts, all
nine arrangements sort by engine before they sort by anything else, and WebKit in
a *translated x86* container paints faster than Chromium on bare metal — 11.0 ms
against 27 to 29.

### Which engine is fastest depends on what you are painting

Capture cost and rasterization cost are separate, and no engine is cheap at both.
Median ms per paint over three 60-paint runs on an Apple M4 Max (16 cores, 64 GB)
under macOS with Playwright 1.62.1, one page reused, both subjects captured the
same way:

| engine | text on a flat fill | 240 blurred gradient cells |
| --- | ---: | ---: |
| chromium | 26.2 | 36.8 |
| firefox | **8.5** | **21.6** |
| webkit | **3.7** | 45.5 |

Chromium pays ~26 ms to take a screenshot at all and then rasterizes cheaply;
WebKit is the reverse, seven times cheaper to capture and four times more
expensive per unit of drawing. **WebKit is the fastest engine on the first
subject and the slowest on the second**, so a ranking measured on one kind of
subject does not transfer to a suite made of the other kind. Firefox is second
on both, and would be the engine to reach for on a mixed or unmeasured suite —
but it is not one of the engines this package declares. `DECLARED_ENGINES` is
`chromium` and `webkit`, because the Playwright Firefox build does not launch
under the macOS sandbox on recent versions, and an engine that is declared and
absent fails a run by name rather than quietly painting in something else. The
row above is a measurement, not a recommendation; declare Firefox only with
`VARIANCE_ENGINES`, on a host where you have confirmed it launches.

To take those numbers on your own machine, run the script the package ships. It
imports nothing from the package itself, so the same bytes run on every host.
Sixty paints per arm, one raster per engine written into `./native`:

```bash
mkdir -p native
node node_modules/@variance-authority/playwright/scripts/host.mjs 60 --out ./native
```

To find out whether another host's pixels are interchangeable with these, run
that same file there. The Playwright image already carries the browsers, and the
script is the only thing you mount:

```bash
mkdir -p box && cp node_modules/@variance-authority/playwright/scripts/host.mjs box/
docker run --rm --ipc=host --user pwuser -v "$PWD/box:/work" -w /work \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  mcr.microsoft.com/playwright:v1.62.1-noble \
  sh -c 'npm i playwright@1.62.1 >/dev/null && node host.mjs --out .'
```

Use `--ipc=host`: on a container's 64 MB `/dev/shm` Chromium crashes rather than
slows down. Use `--user pwuser`: Chromium's sandbox refuses to run as root, and
`--no-sandbox` would make the container arm differ from the native one by a
launch argument.

Then read the two directories against each other — geometry first, then area and
peak at two scales, then chroma. `--compare` decodes PNGs, so it needs
`@variance-authority/png` resolvable from the directory you run it in; `--out`
needs nothing but Playwright.

```bash
npm install --save-dev @variance-authority/png
node node_modules/@variance-authority/playwright/scripts/host.mjs --compare ./native ./box
```

## The renderer: a document in, a raster out

Excerpt — a `RenderDocument` comes from a collector:

```ts
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import type { RenderDocument } from '@variance-authority/core/format';

declare const document: RenderDocument;

const renderer = await createPlaywrightRenderer();
const raster = await renderer.render(document);
```

Chromium launches with `--disable-lcd-text` and `--font-render-hinting=none` by
default. An explicit ordered `launchArgs` list replaces that default. Headless
mode and the ordered launch recipe are hashed into
`RenderIdentity.rasterization`, so changing font rasterization settings
partitions baselines instead of appearing as a product diff.

A resource-closed document is rendered without network access: archived resource
bytes satisfy matching requests and every unresolved request is aborted. A
document without a `resources` field remains a local, environment-dependent
input and may use the network available to the renderer.

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
| `stabilization` | the raster recipe | which tricks hold the page still. Folded into the identity, so a baseline made under one recipe and a run under another are `incomparable` |
| `assemble` | `AssembleOptions` defaults | how the document is turned into a page |
| `concurrency` | `1` | how many documents may be painted at once. Above 1 each render leases its own page, because `setContent` replaces a page's whole document. Worth having: the raster tier is where a run's time is |

It satisfies the `Renderer` contract from `@variance-authority/raster` — the same
contract a renderer running across a network satisfies, so you can swap one for
the other without a rewrite.

It applies the stabilization recipe it is given, and reports conflicts rather
than resolving them.

## Page errors

A bundle that throws leaves the agent global undefined, and the failure would
otherwise surface as a timeout with no cause. Page-side errors are recorded and
reported, so `React is not defined` reads as `React is not defined`. Read them
with `harness.pageErrors()`.

---

**[@variance-authority/playwright](https://variance-authority.dev/reference/packages/playwright)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
