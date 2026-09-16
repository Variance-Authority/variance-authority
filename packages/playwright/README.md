<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/playwright

> A persistent Playwright harness and renderer for Variance Authority: one browser per run, documents turned into rasters.

Use this package when your integration owns a **harness** — a long-lived browser
instance kept open across captures — or needs to turn a `RenderDocument` into a
**raster**, a PNG image plus the conditions it was captured under. A
`RenderDocument` is a serialized snapshot of one **subject**'s rendered state,
where a subject is the story, route, or component variant under test.

If you already have a Playwright Test suite, use
`@variance-authority/playwright-test` instead. For a CLI route or Storybook
collection, use the corresponding collector.

This lower-level package does not choose subjects, mount application state, or
build the `PageAgent` — the in-page object a bundle installs to read a subject
and hand back a capture. Your integration supplies that.

Playwright's browser binaries do not arrive with an `npm install`, so there are
two commands here rather than one:

```bash
npm install --save-dev @variance-authority/playwright
npx playwright install chromium
```

This is the only package in this repository that will ever ask you to install a
browser. Everything downstream of a render — comparison, isolation, attribution,
storage — sits elsewhere and stays reachable without one.

Two tools live here: the harness described above, and a **renderer**, which
turns a single `RenderDocument` into a raster without keeping a browser open
across calls. Beside them sit the wire's observers: `observeNetwork` and its
`freezeGif`, `blank*` and `fetchModules` helpers, `unresizable`, and
`captureOnce` for a single capture without standing up a harness.

## Entrypoints

| entrypoint | holds | note |
|---|---|---|
| `.` | the harness and the network observation | needs `playwright` |
| `playwright/renderer` | `createPlaywrightRenderer` | the renderer alone, without the harness |
| `playwright/agent` | `PageAgent`, `CaptureRequest`, `AGENT_GLOBAL` | **must not** need `playwright` — it is bundled into the page |
| `playwright/engines` | `declaredEngines`, `requireEngines`, `engineStatus` | which engines a run is asked to use, and whether this machine has them |

`playwright/agent` is published separately because it runs inside the browser:
it is injected as a classic script, and importing Playwright behind it would
put a Node module in a bundle destined for a page.

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

| option | default | what it decides |
|---|---|---|
| `url` | required | the page navigated once and reused |
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

## The wire: what the page actually received

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
| `freezeAnimatedImages` | `true` | serve animated GIFs as their first frame. Done on the wire rather than in the page — see [`gif.ts`](src/gif.ts) |
| `blank` | none | `BlankRule[]`: images served as nothing, at their own size. The stronger relative of an ignore mask, and stronger because it happens *first* — a mask hides pixels after the page has fetched the image, laid out around it and folded its bytes into the key. It knows the URL and the intrinsic size, and does not know the DOM |
| `retainResources` | `false` | keep the bytes, not just the digest, so the document can be painted somewhere with no route to this origin. Retention rather than acquisition: every hashed body is already fetched and held long enough to digest, so a portable document costs a map and not a second crawl |

`retainResources` keeps **what was served** — the blank an image became, the
single frame a GIF was truncated to. Keeping what *arrived* would paint a
different picture later than the run that observed it, which is the one thing an
archive exists to prevent. `@variance-authority/route-collector`'s `portable: true`
is this option with a refusal on top.

`assets` is the map folded into the environment key. `frozen` and `blanked` are
ledgers rather than counts — blanking is the one intervention here that can
hide a real regression, so an operator who blanked more than they meant to can
read back exactly what disappeared.

## Where a component is declared, asked of the engine

The source scan answers a name: every declaration in the configured directories
that spells `Button`, and when two do, the name is ambiguous and the report says
so. The page holds something better than a name. The fiber carries the function
React called, and V8 knows where every function it compiled begins. So the page
agent keeps the functions it met, and `createDeclarationReader(page)` asks
Chromium over CDP for each one's `[[FunctionLocation]]`, then maps the position
through the served module's source map to a repository file and line.

```ts
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

`global` names the global the agent is installed at, `AGENT_GLOBAL` unless the
bundle chose another. `fetchModule` supplies the fetch for served modules and
their maps, from inside the page unless told otherwise — the same choice the
call-site path makes, and for the same reason. `root` is the path an answer is
made relative to, the working directory unless told otherwise.

## Which engine paints

```ts
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';

const safari = await createPlaywrightRenderer({ browser: 'webkit' });
```

`chromium` by default; `firefox` and `webkit` are the other two. The browser
binary is still the caller's to install — `npx playwright install webkit`.

### A run measures what it declares

Anything that paints in more than one engine — this package's own cross-engine
suite and benchmarks — takes its list from `playwright/engines` rather than from
whatever is installed:

```ts
import { declaredEngines, requireEngines } from '@variance-authority/playwright/engines';

const engines = requireEngines(declaredEngines()); // ['chromium', 'webkit']
```

`requireEngines` **throws and names the engine** when a declared one is not
installed, because the alternative is a result that changes with the machine: a
laptop missing WebKit measures one engine, reports green, and says nothing about
the claim it did not check. A machine with no browsers at all returns empty,
which is the one case a caller may skip on.

`VARIANCE_ENGINES=chromium,webkit` overrides the list for a single run. It
changes what is asked for, not the rule — whatever it names still has to exist.

**A second engine costs a second paint and nothing else.** A `RenderDocument` is
engine-independent, so it is collected once and rasterized once per engine,
instead of being re-collected for each one.

The engine is part of `RenderIdentity`, which keys the baseline store: a
WebKit baseline lands in its own directory, and a Chromium run that finds one
reports `incomparable`, naming both engines. The supplied stabilization recipe
targets Chromium — use `prepare` for engine-specific controls needed by
Firefox or WebKit.

### Only Chromium can be told how to paint text

`CHROMIUM_RASTER_ARGS` — `--disable-lcd-text`, `--font-render-hinting=none` —
makes Chromium's text independent of host defaults, and there is no equivalent
for Firefox or WebKit. Their text is painted the way the host paints text.
WebKit's one lever is the page's own `-webkit-font-smoothing`, which is not a
substitute: it changes 4,204 pixels of a 500x160 subject, so it changes the subject
rather than the conditions the subject is photographed under.

On macOS none of this bites. The system has had no subpixel antialiasing since
10.14, all four candidate flags are no-ops, and every engine paints greyscale
headed or headless at 1x and 2x. Where fontconfig is live — Linux, so most CI —
the flags are load-bearing for Chromium and absent for the other two. Measured in
`mcr.microsoft.com/playwright:v1.62.1-noble`: Chromium painting a webfont emits
6,662 chromatic pixels, the two flags take that to zero, and Firefox and WebKit are
unaffected because the flags never reached them.

**So a WebKit or Firefox raster is comparable only to one from the same host.**
`RenderIdentity` carries `platform`, so a laptop's baseline and a container's are
separate baselines and a run says `incomparable` rather than comparing them. That
is the safe failure, not a solution: neither answers for the other. If rasters are
produced in a container, produce them only there — a local WebKit renderer records
baselines nothing will ever compare against, and pays the raster tier for them.
The semantic tier is unaffected and stays local.

The container is cheap, which is not what people assume. Measured on an M4 Max
under Docker Desktop 29.0.1, `mcr.microsoft.com/playwright:v1.62.1-noble` costs
Chromium 1.17x and WebKit 1.66x per paint against native macOS, and costs Firefox
nothing at all — it is *faster* in the container, 7.5 ms against 8.3. The same
image run as arm64 and as translated amd64 produces byte-identical rasters, so the
pixels follow the image rather than the machine.

The engine outranks both the host and the emulator: across those three hosts, all
nine arrangements sort by engine before they sort by anything else, and WebKit in
a *translated x86* container paints faster than Chromium on bare metal — 11.0 ms
against 29.0.

### Which engine is fastest depends on what you are painting

Capture cost and rasterization cost are separate, and no engine is cheap at both.
Median ms per paint on macOS, one page reused, both subjects captured the same
way:

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
on both, which makes it the engine to reach for when the suite is mixed or
unmeasured.

`scripts/host.mjs` is the reproduction — it paints both subjects and imports
nothing from this repository, so the same bytes run on every host:

```bash
yarn workspace @variance-authority/playwright host 60
```

```bash
yarn workspace @variance-authority/playwright host --compare ./native ./box/out
```

## The renderer: a document in, a raster out

```ts
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';

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
aborted. A document without a `resources` field remains a local,
environment-dependent input and may use the network available to the renderer.

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

It satisfies the `Renderer` contract from `@variance-authority/raster` — the
same contract a renderer running across a network satisfies, so callers can
swap one for the other without a rewrite.

It applies the stabilization recipe it is given, and reports conflicts rather
than resolving them.

## Page errors

A bundle that throws leaves the agent global undefined, and the failure would
otherwise surface as a timeout with no cause. Page-side errors are recorded and
reported, so `React is not defined` reads as `React is not defined`.
