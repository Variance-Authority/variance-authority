# Connect your suite

A **surface** is the package that connects [Variance Authority](README.md) to
one test suite. It finds the states worth observing, drives your host to each
one, and gives each a stable id. It does not replace your test runner,
assertions, configuration, build, or teardown. This page lists the surfaces,
what each installs, and how to pick one — and, at the end, what to write when
none of them covers your host.

If you have not taken a first subject through a review loop yet, start with the
[getting-started chooser](start.md) and come back here to compare the options.

Two words recur below, and they name the material a surface keeps:

- **Deferred** rendering keeps a render document and paints it later, through a
  local or a remote renderer.
- **In-place** rendering keeps a raster the host already painted, with no
  separate render step.

Both reach the same observation, retention, and reporting path. The choice
changes cost and disclosure, not the verdict you get.

## 1. What you install

Pick the row for the host that already reaches the state you want to review.
Everything the surface needs beyond that stays behind its package boundary.

| Existing host | Install | Material and placement |
| --- | --- | --- |
| Built or served Storybook | `@variance-authority/cli` and `@variance-authority/storybook-collector` | Document rendered later; a remote renderer needs equivalent resource access. |
| Served routes or a static directory | `@variance-authority/cli` and `@variance-authority/route-collector` | Document rendered later, resource-closed on request so a remote renderer needs no access to the origin. |
| Existing Playwright Test | `@variance-authority/playwright-test` | Deferred document by default, or explicit in-place raster from the caller-owned page. |
| Jest or Vitest with jsdom | `@variance-authority/unit-test` and `@variance-authority/cli` | Resource-closed document archive written in the unit process and rendered by a later CLI process. |
| Vitest browser mode | `@variance-authority/vitest-browser` | Document read in the tab and painted in the Vitest process, which owns the baseline and the verdict. |
| Custom library composition | `@variance-authority/observe` | Existing raster or document material through an injected store and, for documents, a renderer. |

For a Storybook, that first step is:

```bash
npm install --save-dev @variance-authority/cli @variance-authority/storybook-collector
npx playwright install chromium
```

Playwright's browser binaries do not arrive with an `npm install`, which is what
the second command is for. Every path that paints needs it, including the
Playwright Test and unit-test surfaces.

`@variance-authority/cli` supplies the `variance` binary: `variance run`,
`variance report`, `variance accept`, `variance doctor`. The Playwright Test and
Vitest browser surfaces own their loop inside the existing test run and do not
need it; the collector-based surfaces do.

## 2. By suite

### Storybook

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
variance run --config variance.config.json
```

Storybook subject ids carry a `story:` prefix, so a story whose Storybook id is
`checkout--empty` is accepted as `story:checkout--empty`.

`source.dirs` is what resolves a component to the file it is declared in. A
built Storybook ships bundled code: the browser can say which component drew an
element, not which file it is written in, so the collector scans your tree
instead.

**Set `keepNames` in the Storybook build, or the report names components that do
not exist in your source.** Minification renames component functions, so a run
against a built Storybook reports the cause as `Ce` rather than `Button`, and
that name matches nothing the source scan indexed — you get a confident report
pointing at a component you cannot find. The key moved with Vite:
`build.rolldownOptions.output.keepNames` on Vite 8,
`esbuild.keepNames` on Vite 7 and below. A config carrying the other major's key
is read by nothing and warns about nothing, so check which Vite your Storybook
runs on. A development Storybook needs neither key.

Names and declarations are one level of precision. Resolving a changed element
to the line it is *written* on, rather than the line its component is declared
on, additionally needs the
[`@variance-authority/jsx-source`](../packages/jsx-source/README.md) plugin and
automatic development JSX emission in the build. Collection, comparison, and
declaration-level attribution work without it.

This route produces documents. A run may paint them locally, reuse a cached
raster, or use a remote renderer that can reach the same resources. The
collector records resource hashes but not resource bytes, so its output is not a
portable resource-closed archive, and acquisition is unchanged by where the
renderer sits.

[`@variance-authority/storybook-collector`](../packages/storybook-collector/README.md)
carries every collector option: `baseUrl`, `ready`, `loading`, `readyTimeoutMs`,
`roots`. The walkthrough is
[compare Storybook stories against approved screenshots](start-storybook.md).

### Playwright

The Playwright Test integration is additive:

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

The deferred default acquires from the caller's locator and paints the document
through a separate renderer. It supports render-cache reuse and a local or remote
renderer with equivalent resource access; this adapter does not archive external
resource bytes.

The explicit in-place option captures the caller-owned locator twice, refuses
same-run pixel disagreement, and hands the agreeing raster straight to baseline
comparison. It requires the suite to declare the browser launch recipe used by
its Playwright configuration; the declaration enters renderer identity.

```ts
import { CHROMIUM_RASTER_ARGS, createVariance } from '@variance-authority/playwright-test';

const variance = await createVariance(page, testInfo, {
  materialization: {
    kind: 'in-place',
    browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
  },
});
```

Both placements acquire Playwright-native ARIA snapshots from the locator and
its React portal content. The report keeps document, pixel, and browser
accessibility results separately, so a browser accessibility change is
reviewable even when no pixel moved.

The package exports neither `test` nor `expect`. Fixtures and matcher parts are
unbound values for suites that already own a shared extension module. The
walkthrough is [start with Playwright](start-playwright.md).

### Jest and Vitest

Vanilla Jest or Vitest has a DOM and no rasterizer, so the unit surface does
acquisition only:

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
local or remote browser. The unit process has finished before that browser
starts. External resources must be supplied as immutable bytes during capture;
unresolved resources are refused. The walkthrough is
[start from a unit test](start-unit.md).

Vitest Browser Mode with the Playwright provider is the Playwright composition.
It is not the browserless unit route under another name.

### Any other suite

For an unsupported browser harness, write a collector — section 4 gives the
three contracts. For a mounted browserless DOM, the unit-test surface already
supplies the archive and the collector lifecycle.

Cypress, WebdriverIO, and Appium get no special status from being test runners.
An adapter for one of them would name subjects and emit the shared capture
material; it would not create a second comparison or retention pipeline.

## 3. What each material costs

| Choice | Saves | Pays | Best fit |
| --- | --- | --- | --- |
| In-place raster | reconstruction and a second browser | host-browser identity discipline; repeated screenshots; raster egress if remote review follows | state already reached in a stable, pinned browser, where disclosing the DOM is unacceptable |
| Deferred local document | application rerun; enables render caching | resource closure or equivalent-access discipline, plus local browser cost | browserless acquisition or one pinned local renderer |
| Deferred remote document | pinning the acquisition machine; enables remote fan-out | disclosure of the document and its resources, plus transport; environment-dependent documents require equivalent resource access | shared render service; cross-environment portability only for closed documents |
| Existing raster library input | all acquisition and rendering work | reduced semantic evidence unless the caller supplies it | another trusted capture system already owns pixels and identity |

Renderer identity partitions durable baselines by engine, platform, scale,
fonts, stabilization, and rasterization recipe. Chromium rendering defaults to
`--disable-lcd-text` and `--font-render-hinting=none`; changing the ordered
launch recipe changes identity, so a font rasterization difference is reported
as a refused comparison rather than as a component regression. See
[baseline placement](placement.md).

## 4. Writing a surface for a host that has none

A custom integration names a subject, acquires its state, and chooses where the
resulting material goes. The surfaces above remove one or more of those steps;
write these three only when none of them covers your host.
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
every subject follows afterward: the renderer paints a raster if the material
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

## 5. Bringing pixels this system did not paint

The observation engine accepts an existing `Raster`. A `CaptureArtifact` with
`material.kind: "raster"` reaches `observeCaptureAgainstBaseline` without a
renderer, and `observeRasters` compares two images already in hand. Compose that
yourself with `@variance-authority/observe`; the `variance` binary has no
foreign-image ingest command, because its acceptance workflow reads the stored
candidate raster, semantic evidence, and renderer identity that a run creates
together.

A foreign raster is useful only with an honest identity declaration. Without a
snapshot it also carries no component attribution, exclusions, or band-specific
policy; those fields stay absent rather than being inferred from pixels.

| Material you hold | Entrypoint |
| --- | --- |
| A render document | `Renderer.render(document)`, local or a configured remote endpoint |
| A raster | `observeCaptureAgainstBaseline`, or `observeRasters` for two images in hand |
| Storage for either | `RasterStore` and `RenderCache`, a durable directory or a configured remote backend |

## 6. What a surface has to hold

Each expensive or host-bound capability arrives as a value — collector,
renderer, store, decoder, source evidence — so a remote renderer implements the
same `Renderer` contract as the local one, and an in-place raster skips that
contract and joins the same observation path afterwards. What that costs you:

- A surface preserves the host's lifecycle and names stable subjects.
- A portable document closes over every resource it needs to paint.
- An in-place browser declares the launch recipe that owns its pixels.
- A baseline store refuses cross-identity comparison.
- Repeated-render instability is classified before baseline difference.
- Missing semantic or source evidence reduces the report instead of inventing an
  empty answer.

Types, artifact validation, identity digests, and tests carry those, so a run
tells you when one is unmet.
