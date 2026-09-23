# Connect your suite

You already have a suite that gets the app into the UI states you care about. To
put those states under review by [Variance Authority](README.md), you install
one package that knows your host, and keep everything else.

That package is called a **surface**. It finds the states worth observing,
drives your host to each one, and gives each a **subject id**: one named UI
state you asked for and can ask for again, such as `cart/empty`. A surface does
not replace your test runner, assertions, configuration, build, or teardown.

This page lists the surfaces, what each installs, and how to pick one. The last
section is what to write when none of them covers your host. If you have not
taken a first subject through a review loop yet, start with the
[getting-started chooser](start.md) and come back here to compare.

Two words describe what a surface hands on, and they run through every table
below.

- A **render document** is the subject's DOM with its styles, its resources and
  its component provenance, kept so pixels can be painted from it later — by a
  browser the run launches locally, or by a remote renderer you configure.
- A **raster** is a screenshot: pixels the host has already painted, handed
  straight to comparison with no second render.

Both end in the same comparison and the same report. The choice changes what a
run costs and what it discloses, not the verdict you get.

## 1. What you install

Pick the row for the host that already puts the app in the state you want to
review. Everything the surface needs beyond that stays behind its package
boundary.

| Existing host | Install | What it keeps, and where it is painted |
| --- | --- | --- |
| Built or served Storybook | `@variance-authority/cli` and `@variance-authority/storybook-collector` | A render document, painted afterwards; a remote renderer needs the same access to your resources that the run had. |
| Served routes or a static directory | `@variance-authority/cli` and `@variance-authority/route-collector` | A render document that can be closed over its resources on request, so a remote renderer needs no access to your origin. |
| Existing Playwright Test | `@variance-authority/playwright-test` | A render document by default, or — when you ask for it — a raster taken in place from the page your test already owns. |
| Jest, Vitest or Rstest with jsdom | `@variance-authority/unit-test` and `@variance-authority/cli` | A resource-closed document archive written in the unit process and painted by a later CLI process. |
| Vitest browser mode | `@variance-authority/vitest-browser` | A document read in the tab and painted in the Vitest process, which owns the baseline and the verdict. |
| Custom library composition | `@variance-authority/observe` | Whichever you already use, through a store you inject and — for documents — a renderer you supply. |

Your tests run in whichever engine they already run in; nothing here has an
opinion about that. The engine question is about the raster that becomes a
baseline, and it only becomes a hard one when two machines have to agree on
that raster. `--disable-lcd-text` and `--font-render-hinting=none` are flags no
other engine accepts, so Chromium is the only engine whose text rasterization
you can pin and get back somewhere else; WebKit and Firefox paint text the way
their host does, which makes their baselines that host's property. Give them
one host, or one container image, and keep it, and they are as good a painter
as anything — [how this compares](comparison.md) sets out what else follows
from the engine.

Pinning is not the fast way to take the photograph. Chromium spends most of its
cost taking a screenshot at all — on one machine, around seven times what WebKit
pays — and wins that back only on subjects that are expensive to draw. It is the
fast way to do everything around the photograph: on the same machine it starts a
process 4.4x faster than WebKit and lays out a DOM 1.8x faster, and the two
interpreters are within a few percent. The engine that is cheapest to photograph
with is not the engine that is cheapest to run a suite in — [what a paint
costs](../packages/playwright/README.md#which-engine-is-fastest-depends-on-what-you-are-painting)
and [what a run
costs](../packages/playwright/README.md#the-engine-that-paints-fastest-does-not-run-a-suite-fastest)
have both tables and the machine they were taken on.

Which machine runs it is yours. The `npx playwright install chromium` in each
install below is one answer among several: a pinned container image paints the
same bytes wherever it is started, a `"renderer": { "endpoint": … }` in the
configuration paints on a machine you do not provision per run, and a surface
that defers painting lets the suite run with no browser present at all and the
painting be a CI job's. What matters to a verdict is that one painter is pinned
for laptop and CI, not which one — [what each choice
costs](#4-what-each-choice-costs) prices them and [where baselines
live](placement.md) covers what each does to identity.

`@variance-authority/cli` supplies the `variance` binary: `variance run`,
`variance report`, `variance accept`, `variance doctor`. The Playwright Test and
Vitest browser surfaces run their loop inside the existing test run and do not
need it; the collector-based surfaces do. Installed as a devDependency, the
binary is not on your `PATH`, so call it as `npx variance …`.

## 2. By suite

### Storybook

```bash
npm install --save-dev @variance-authority/cli @variance-authority/storybook-collector
npx playwright install chromium
```

The Storybook collector reads `index.json`, reuses one preview, switches stories
through Storybook's channel, waits for the rendered state, and acquires each
subject. It runs beside Storybook: it installs no addon, reads no `.storybook`
directory, and does not own your build command.

Build the Storybook first, then write a collector module that says where your
components live:

```js
// variance/storybook.mjs
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  source: { dirs: ['src'] },
});
```

Point the run config at the built index and that module:

```jsonc
// variance.config.json
{
  "project": "checkout-ui",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": {
    "kind": "storybook",
    "index": "storybook-static/index.json",
    "collector": "variance/storybook.mjs"
  },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "report": ".variance/report.json"
}
```

```bash
npx variance run --config variance.config.json
```

Storybook subject ids begin with `story:`, so a story whose Storybook id is
`checkout--empty` is accepted as `story:checkout--empty`.

`source.dirs` is what resolves a component to the file it is declared in. A
built Storybook ships bundled code: the browser can say which component drew an
element, not which file it is written in, so the collector scans your tree
instead.

#### Keep component names in the Storybook build

Minification renames component functions, so a run against a built Storybook
reports the cause as `Ce` rather than `Button`, and that name matches nothing
the source scan indexed — a confident report pointing at a component you cannot
find. The setting that prevents it is your bundler's, not this system's, and for
a Storybook on the Vite builder it goes in `.storybook/main.js` (or
`main.ts`), inside `viteFinal`.

On Vite 7 and below, the key is `esbuild.keepNames`:

```js
// .storybook/main.js
export default {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  framework: { name: '@storybook/react-vite', options: {} },
  viteFinal: async (config) => ({
    ...config,
    esbuild: { ...config.esbuild, keepNames: true },
  }),
};
```

On Vite 8, the same setting moved to `build.rolldownOptions.output.keepNames`:

```js
// .storybook/main.js
export default {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  framework: { name: '@storybook/react-vite', options: {} },
  viteFinal: async (config) => ({
    ...config,
    build: {
      ...config.build,
      rolldownOptions: {
        ...config.build?.rolldownOptions,
        output: { ...config.build?.rolldownOptions?.output, keepNames: true },
      },
    },
  }),
};
```

A config using the other major's key is read by nothing and warns about
nothing, so check which Vite your Storybook runs on. A development Storybook
needs neither key.

Names and declarations are one level of precision. Resolving a changed element
to the line it is *written* on, rather than the line its component is declared
on, additionally needs the
[`@variance-authority/jsx-source`](../packages/jsx-source/README.md) plugin and
automatic development JSX emission in the build. Collection, comparison, and
declaration-level attribution work without it.

The collector records resource hashes but not resource bytes, so its output is
not a portable resource-closed archive: a remote renderer painting it needs the
same access to those resources that the run had.

[`@variance-authority/storybook-collector`](../packages/storybook-collector/README.md)
lists every collector option: `baseUrl`, `ready`, `loading`, `readyTimeoutMs`,
`roots`. The walkthrough is
[compare Storybook stories against approved screenshots](start-storybook.md).

### Served routes or a static directory

```bash
npm install --save-dev @variance-authority/cli @variance-authority/route-collector
npx playwright install chromium
```

Use this when a server already owns routing and page state and the application
route — not an isolated component — is what you want to review. The collector
navigates the URLs you name and nothing else: it does not crawl links, start
your application, or log in. For a route that only exists behind a login, keep
the login where it already works and use the Playwright surface below.

Name each route and bound the part of the page that is the subject:

```js
// variance/routes.mjs
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: {
    'checkout/empty': 'http://localhost:3000/checkout',
    'checkout/one-item': 'http://localhost:3000/checkout?items=1',
  },
  roots: ['#app'],
  ready: { 'checkout/one-item': '[data-testid="cart-ready"]' },
  source: { dirs: ['src'] },
});
```

`roots` is an ordered list of CSS selectors, and the first that matches is the
subject. The default is `['body']`, meaning the whole page. A tighter root keeps
a shared header out of every route's comparison, so an edit to the header does
not change forty routes at once. If none of the selectors matches, the route is
a collection failure rather than an empty capture.

`ready` names a marker to wait for, keyed by subject id or by a glob over
subject ids. The collector already waits for page load and for React Suspense
boundaries under your roots to resolve; `ready` is for anything that finishes
later, such as a fetch issued after mount. A route that declares a marker and
never attaches it times out after `readyTimeoutMs` — 10000 by default — and is
reported as a collection failure naming the selector it waited for.

`source.dirs` is optional and turns a component name into a `file:line`. Point
it at the directories your components live in, relative to the config; a path
matching no files is refused by name.

Then declare the same ids in the run config, with the application running:

```jsonc
// variance.config.json
{
  "project": "checkout-ui",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": {
    "kind": "list",
    "ids": ["checkout/empty", "checkout/one-item"],
    "collector": "variance/routes.mjs"
  },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "fonts": [],
  "report": ".variance/report.json"
}
```

```bash
npx variance doctor --config variance.config.json
npx variance run --config variance.config.json
```

An id named in the config with no matching route in the collector is a
collection failure; a route in the collector that the list does not name is
never planned.

When your build already publishes the inventory, let the collector plan the
subjects instead. Use exactly one of `routes`, `sitemap` or `directory`: with
`sitemap: 'http://localhost:3000/sitemap.xml'` the ids come from the URL paths,
and with `directory: './build'` the collector serves the built output itself and
creates one subject per `.html` file. The config then names no ids:

```jsonc
// the subjects block of variance.config.json
{
  "subjects": {
    "kind": "collector",
    "collector": "variance/routes.mjs"
  }
}
```

The walkthrough is [put one served route through review](start-routes.md). The
[`@variance-authority/route-collector` reference](../packages/route-collector/README.md)
owns responsive widths, capturing a route on a machine that has no access to
your asset origin, and the complete option contract.

### Playwright

```bash
npm install --save-dev @variance-authority/playwright-test @playwright/test
npx playwright install chromium
```

The Playwright Test integration is additive: the test keeps its runner,
navigation, fixtures and existing assertions.

```ts
import { test, expect } from '@playwright/test';
import { assertUnchanged, observe } from '@variance-authority/playwright-test';

test('empty cart', async ({ page }, testInfo) => {
  await page.goto('https://example.test/cart');
  const observation = await observe(page, page.getByTestId('cart'), testInfo, {
    subjectId: 'cart/empty',
  });

  assertUnchanged(observation);
  expect(observation.subject).toBe('cart/empty');
});
```

The default acquires a render document from the caller's locator and paints it
through a separate renderer. It supports render-cache reuse and a local or
remote renderer with equivalent access to your resources; it does not archive
external resource bytes.

The in-place option captures the caller-owned locator twice, refuses a same-run
disagreement between the two, and hands the agreeing raster straight to baseline
comparison. It requires the suite to declare the browser launch recipe used by
its Playwright configuration, because that recipe is part of what identifies the
renderer:

```ts
import { CHROMIUM_RASTER_ARGS, createVariance } from '@variance-authority/playwright-test';

const variance = await createVariance(page, testInfo, {
  materialization: {
    kind: 'in-place',
    browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
  },
});
```

Either way, Playwright-native ARIA snapshots are acquired from the locator and
its React portal content. The report keeps document, pixel, and browser
accessibility results separately, so a browser accessibility change is
reviewable even when no pixel moved.

The package exports neither `test` nor `expect`. Fixtures and matcher parts are
unbound values, for suites that already own a shared extension module. The
walkthrough is [start with Playwright](start-playwright.md).

### Jest, Vitest and Rstest

The acquisition half installs into the test runner, with the DOM environment it
uses. It imports no runner, so any of the three that gives it a DOM is the same
install:

```bash
npm install --save-dev @variance-authority/unit-test jsdom
```

The painting half is a separate process and a separate install, in the job that
runs `variance`:

```bash
npm install --save-dev @variance-authority/cli
npx playwright install chromium
```

Vitest needs `// @vitest-environment jsdom` at the top of the test file, or the
equivalent project setting; Jest needs its normal `jsdom` test environment, and
Rstest `testEnvironment: 'jsdom'`. A runner with a DOM and no rasterizer is what
this surface is for, so it does acquisition only:

```ts
import { test, expect } from 'vitest';
import { capture, writeCapture } from '@variance-authority/unit-test';

test('save button', async () => {
  const artifact = await capture(document.querySelector('button')!, {
    subject: 'button/save',
    viewport: { width: 320, height: 200, deviceScaleFactor: 1, colorScheme: 'light' },
  });
  await writeCapture('.variance/captures', artifact);
  expect(document.querySelector('button')?.textContent).toBe('Save');
});
```

A later `variance run` loads those artifacts and paints them with its configured
local or remote browser; the unit process has finished before that browser
starts. External resources must be supplied as immutable bytes during capture,
and an unresolved resource is refused. The walkthrough is
[start from a unit test](start-unit.md).

### Vitest browser mode

```bash
npm install --save-dev @variance-authority/vitest-browser vitest-browser-react
npx playwright install chromium
```

Two browsers are involved: the one the suite mounts components in, and the one
this package paints the baseline image with. The second is why the install is
not only the suite's own.

The test body runs in a tab, which has neither the baseline nor a browser to
paint with, so the plugin that hands the work back to the Vitest process is
required rather than optional:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { variancePlugin } from '@variance-authority/vitest-browser/node';

export default defineConfig({
  plugins: [react(), variancePlugin({ baselines: '.variance/baselines' })],
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
    },
  },
});
```

Then observe from inside a test:

```tsx
import { render } from 'vitest-browser-react';
import { expect, test } from 'vitest';
import { assertUnchanged, variance } from '@variance-authority/vitest-browser';

test('the save button, disabled', async () => {
  const screen = render(<SaveButton disabled />);
  await expect.element(screen.getByRole('button')).toBeVisible();

  assertUnchanged(await variance(screen.container));
});
```

The subject id defaults to the running test's full name, so renaming a test
orphans its baseline and the next run reports `new` rather than comparing
against something else. Pass `subjectId` to pin the id.

Browser mode with the Playwright provider is the Playwright composition, run
inside the Vitest process, which owns the baseline and the verdict. It is not
the browserless unit route under another name. The walkthrough is
[start with Vitest browser mode](start-vitest-browser.md).

### Any other suite

For an unsupported browser harness, write a collector — section 5 gives the
three contracts. For a mounted browserless DOM, the unit-test surface already
supplies the archive and the collector lifecycle.

An adapter for Cypress, WebdriverIO or Appium would name subjects and emit the
same documents and rasters as the surfaces above; it would not bring a
comparison or retention path of its own.

## 3. Approve a change

A first run reports every subject `new` and exits `1`, because no baseline has
been approved for those ids yet. Nothing is accepted on your behalf. Write the
report as HTML beside its JSON source, so the relative image links work, and
look at the candidate:

```bash
npx variance report --config variance.config.json --format html > .variance/report.html
```

If the candidate is the state you intended, approve it by id and rerun:

```bash
npx variance accept --config variance.config.json cart/empty
npx variance run --config variance.config.json
```

`accept` promotes exactly the image the run under review produced; it never
renders a replacement, and it launches no browser. With
`baselines.kind: "directory"` it writes two files per subject under the baseline
root: the `.png`, and a `.json` beside it recording which renderer painted the
image, its dimensions, and what it may be compared against. A candidate whose
run left no such sidecar is refused by name rather than reconstructed. The
second run then reports `unchanged` and exits `0`.

Four flags:

| Flag | What it does |
| --- | --- |
| `--all` | Promotes every changed candidate in the report. Keep it for a first run and for deliberate re-baselines: it cannot tell a candidate somebody reviewed from one nobody opened. |
| `--shape <fingerprint>[,…]` | Promotes one category of difference wherever it accounts for the *whole* change, and refuses by name any subject where something else also changed. Copy a fingerprint out of a report; every region has its own. |
| `--message-file <path>` | Writes a commit message for the baseline update to that path, for `git commit -F`. It commits nothing itself. |
| `--message <text>` | The subject line of that message. Only meaningful with `--message-file`. |

Subject ids, `--all` and `--shape` are mutually exclusive, and `accept` with
none of them is refused. Committing the changed `.png` and `.json` is what makes
the new approved image a diff in the pull request, reviewed like any other
change.

## 4. What each choice costs

| Choice | Saves | Pays | Best fit |
| --- | --- | --- | --- |
| Raster taken in place | reconstruction and a second browser | keeping the host browser's identity pinned; repeated screenshots; raster egress if remote review follows | a state you already have in a stable, pinned browser, where disclosing the DOM is unacceptable |
| Document painted locally | rerunning the application; enables render caching | closing the document over its resources, or guaranteeing the renderer the same access, plus local browser cost | browserless acquisition, or one pinned local renderer |
| Document painted remotely | pinning the acquisition machine; enables remote fan-out | disclosing the document and its resources, plus transport; an environment-dependent document requires equivalent resource access | a shared render service; cross-environment portability, for closed documents only |
| A raster you already have | all acquisition and rendering work | less semantic evidence, unless you supply it yourself | another trusted capture system already owns the pixels and the identity |

Baselines are partitioned by renderer identity: engine, platform, scale, fonts,
stabilization, and rasterization recipe. Chromium rendering defaults to
`--disable-lcd-text` and `--font-render-hinting=none`; changing the ordered
launch recipe changes identity, so a font rasterization difference comes back as
a refused comparison rather than as a component regression. Choose between a
committed directory, Git LFS and a remote store in
[where baselines live](placement.md), which also covers what each costs.

## 5. What each surface reaches

Every surface ends in the same comparison and the same report, and they do not
all carry the same evidence into it. Some of what you get follows the host you
already have rather than anything you configure, so read the row you need most
before you pick.

| What you get | Storybook | Served routes | Playwright Test | jsdom unit | Vitest browser | `observe` |
| --- | --- | --- | --- | --- | --- | --- |
| Component names behind changed pixels | Read from the preview | Read from the page | Read from the page | Pass `provenanceOf` | Read from the tab | Whatever you supply |
| `file:line` beside each name | When the build keeps names and sources | When the build keeps names and sources | Pass a `source` index | Carried by the reader you pass | When the build keeps names and sources | Whatever you supply |
| Wiring band, and holdings on request | Yes | Yes | Yes | Pass `wiringOf` and `holdingOf` | Yes | Whatever you supply |
| Sensitivity levels | Named in the run configuration | Named in the run configuration | Declared per observation | Named in the configuration of the painting run | Declared per observation | Declared per observation |
| Subject held still before it is read | Yes | Yes | Yes, and one still moving is re-read until it rests | You hold it, and the recipe's digest joins the capture | Yes | You hold it |
| Before, after and diff images | Written by the report | Written by the report | Written beside the verdict | Written by the report | Not written | You hold both images |
| Approving a change | `variance accept` | `variance accept` | Promoted in the run that observed it | `variance accept` | Vitest's own `--update` | Your store |
| The same subject across runs | Kept, with a `history` endpoint configured | Kept, with a `history` endpoint configured | Not kept from this path | Kept, with a `history` endpoint configured | Not kept from this path | Your store |
| Which tests to run after a diff | Per story | Not recorded | Per spec file, and per test | Per test file, and per case | Per test file | Not recorded |
| `parted` and `unentered` findings | Yes | Not recorded | Yes | Yes | Yes | Not recorded |
| One execution followed into a service | No | No | Yes | No | No | No |

The last three rows are written by your runner rather than by the surface, so
they arrive on a different install and answer a different question — not *did
this subject change* but *which tests could this commit have moved*. A jsdom
suite gets them from the Vitest, Jest or Rstest integration, a Vitest
browser-mode suite from the same Vitest integration, and a Playwright suite from
the recording fixtures beside its observations; [what each host
records](execution-record.md#what-each-host-records) is the per-runner detail,
and [own fewer tests](own-fewer-tests.md) is the loop they serve.

## 6. Writing a surface for a host that has none

A custom integration names a subject, acquires its state, and chooses where the
resulting document or raster goes. The surfaces above remove one or more of
those steps; write these three only when none of them covers your host.
[Write a custom collector](start-custom.md) takes one through end to end.

### The collector — three methods

The CLI collector contract is for hosts whose subjects are observed as a run:

```ts
interface Collector {
  plan(): Promise<Plan>;
  collect(subject: PlannedSubject): Promise<Collected>;
  close(): Promise<void>;
}
```

`plan` names what the run intends to observe. `collect` returns a render document
and optional semantic and source evidence. `close` releases the host. The
Storybook, route, and unit-capture surfaces implement this contract.

Collectors do not choose the renderer or the baseline store. `variance run` wires
their documents to the configured local or remote renderer, then to the path
every subject follows afterward: the renderer paints a raster if what arrived
was a document, the **observation engine** — the
`@variance-authority/observe` package that compares two images and returns one
verdict — compares that raster against the subject's baseline, and the run
writes the result into its report.

### The page agent — one method

A browser collector installs a serializable page-side acquisition method:

```ts
interface PageAgent {
  capture(root: Element, request: CaptureRequest): Promise<RawCapture>;
}
```

The Storybook and route collectors include their own agent. The Playwright Test
surface also bundles one, because the suite's existing `Locator` already
identifies the root.

### Provenance — one function

Acquisition may inject component [provenance](attribution.md) without making the
DOM package framework-specific:

```ts
type ProvenanceOf = (element: Element) => Provenance | undefined;
```

Absence reduces [attribution](attribution.md); it does not prevent capture or
pixel comparison. React and emitted `data-*` metadata are supported provenance
sources. The surface decides which one is available before acquisition.

## 7. Bringing pixels this system did not paint

```bash
npm install --save-dev @variance-authority/observe
```

The observation engine accepts an existing `Raster`. A `CaptureArtifact` with
`material.kind: "raster"` goes into `observeCaptureAgainstBaseline` without a
renderer, and `observeRasters` compares two images already in hand. Compose that
yourself: the `variance` binary has no command for ingesting a foreign image,
because `variance accept` reads the stored candidate raster, semantic evidence
and renderer identity that a run writes together.

A foreign raster is only useful with an honest identity declaration. Without a
snapshot it supplies no component attribution, exclusions, or band-specific
policy, and those fields stay absent rather than being inferred from pixels.

| What you start from | Entrypoint |
| --- | --- |
| A render document | `Renderer.render(document)`, local or a configured remote endpoint |
| A raster | `observeCaptureAgainstBaseline`, or `observeRasters` for two images in hand |
| Storage for either | `RasterStore` and `RenderCache`, a durable directory or a configured remote backend |
