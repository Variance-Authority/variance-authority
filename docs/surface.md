# Surface

A suite connects to [Variance Authority](README.md) by composing independent choices:

1. the host reaches the state to observe;
2. acquisition keeps either a `RenderDocument` or a `Raster`;
3. a document is painted by a local or remote renderer, while a raster is
   already painted;
4. both reach the same observation, retention, and reporting contracts.

The code that carries out step 1 above — reaching the host's state — is the
**host adapter**: it discovers which subjects exist, drives the host through
render or navigation, and gives each subject its stable id. It does not
replace the host's test runner, assertions, configuration, build, or teardown.
The resulting combination is chosen for the suite's privacy, latency,
repeatability, and coverage requirements. Steps 2 and 3 above are also named:
**deferred** rendering keeps a document and paints it later, through a local
or remote renderer; **in-place** rendering keeps a raster that is already
painted, with no separate render step. Both are first-class.

A **surface** is the adopter-facing package built for one host. It bundles a
host adapter and, where the host runs in a browser, a page agent, behind a
single import, so a suite installs one package instead of composing those
pieces itself. "Surface" and "adopter-facing package" name the same thing;
this page uses both.

## 1. The three things you write

The smallest integration names a subject, acquires its state, and chooses where
the resulting material goes. Host surfaces remove one or more of those steps.

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

Collectors do not choose the renderer or baseline store. `variance run` wires
their documents to the configured local or remote renderer, then to the same
path every subject follows afterward: the renderer paints a raster if the
material was a document, the **observation engine** — the
`@variance-authority/observe` package that compares two images and returns
one verdict — compares that raster against the subject's baseline, and the
run writes the result into its report.

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

Acquisition may inject component [provenance](attribution.md) without making the DOM package
framework-specific:

```ts
type ProvenanceOf = (element: Element) => Provenance | undefined;
```

Absence reduces [attribution](attribution.md); it does not prevent capture or pixel comparison.
React and emitted `data-*` metadata are supported provenance sources. The host
surface decides which one is available before acquisition.

## 2. What you install

Choose the adopter-facing package for the host. Its collaborators remain behind
that package boundary.

| Existing host | Surface | Material and placement |
| --- | --- | --- |
| Built or served Storybook | `@variance-authority/storybook-collector` | Document rendered later; a remote renderer needs equivalent resource access. |
| Served routes or a static directory | `@variance-authority/route-collector` | Document rendered later, resource-closed on request so a remote renderer needs no access to the origin. |
| Existing Playwright Test | `@variance-authority/playwright-test` | Deferred document by default, or explicit in-place raster from the caller-owned page. |
| Jest or Vitest with jsdom | `@variance-authority/unit-test` | Resource-closed document archive written in the unit process and rendered by a later CLI process. |
| Custom library composition | `@variance-authority/observe` | Existing raster or document material through an injected store and, for documents, a renderer. |

The CLI, renderer, and store packages remain available for operators composing
their own run. Adopter-facing examples import one surface package; reaching
through it to its collaborators is not required.

## 3. By suite

### Storybook

The Storybook collector reads `index.json`, reuses one preview, switches stories
through Storybook's channel, waits for the rendered state, and acquires each
subject. It operates beside Storybook: it does not install an addon, modify
`.storybook`, replace the renderer, or own the build command.

One optional capability is bought in the build rather than beside it. A built,
minified Storybook reports the line each component is **declared** on; resolving
a changed element to the line it is *written* on additionally requires the
[`jsx-source`](../packages/jsx-source) plugin and automatic development JSX
emission. Preserving component names through minification is a separate
setting, and it moved with Vite: `build.rolldownOptions.output.keepNames` on
Vite 8, `esbuild.keepNames` on Vite 7 and below. A development Storybook needs
none of these settings, and every other part of collection is unaffected either
way.

This route deliberately produces documents. A run may paint them locally, reuse
a cached raster, or use a remote renderer that can reach the same resources. The
Storybook collector records resource hashes but not resource bytes, so its output
is not a resource-closed portable archive. Acquisition is unchanged by renderer
placement.

See [`@variance-authority/storybook-collector`](../packages/storybook-collector)
for the collector module and configuration.

### Any other suite

A host-specific surface is useful only when it removes real host work without
taking ownership of the host. For an unsupported browser harness, a custom
collector can satisfy `plan`, `collect`, and `close`. For a mounted browserless
DOM, the unit-test surface already supplies the archive and collector lifecycle.

Cypress, WebdriverIO, and Appium do not acquire special status from being test
runners. Their adapters would name subjects and emit the shared capture material;
they would not create new comparison or retention pipelines.

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

Both placements acquire Playwright-native ARIA snapshots from the locator and
its React portal content. The report keeps document, pixel, and browser
accessibility results separately; a browser accessibility change is reviewable
even when the image has no changed pixels.

```ts
import { CHROMIUM_RASTER_ARGS, createVariance } from '@variance-authority/playwright-test';

const variance = await createVariance(page, testInfo, {
  materialization: {
    kind: 'in-place',
    browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
  },
});
```

The package exports neither `test` nor `expect`. Fixtures and matcher parts are
unbound values for suites that already own a shared extension module.

### Jest and Vitest

Vanilla Jest or Vitest has a DOM and no rasterizer. The unit surface therefore
does acquisition only:

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

A later `variance run` loads those artifacts with `captureCollector` and uses its
configured local or remote browser. The unit process has finished before that
browser starts. External resources must be supplied as immutable bytes during
capture; unresolved resources are refused.

Vitest Browser Mode with the Playwright provider is the Playwright composition.
It is not the browserless unit route under another name.

## 4. What cannot enter, and where the binary stops

### An image this system did not paint

The observation engine accepts an existing `Raster`. A `CaptureArtifact` with
`material.kind: "raster"` reaches `observeCaptureAgainstBaseline` without a
renderer, and `observeRasters` compares two images already in hand.

The CLI does not expose a foreign-PNG ingest command. Its run collectors produce
documents, and its acceptance workflow expects the render cache's stored
candidate raster (the `RenderCache` seam in the table below), plus the
semantic evidence and renderer identity a run creates alongside it. That CLI
boundary is not a claim that raster evidence is forbidden from the engine.

A foreign raster is useful only with an honest identity declaration. Without a
snapshot it also has no component attribution, exclusions, or band-specific
policy; those fields remain absent rather than being inferred from pixels.

### Three seams the library opens, and what the binary does with each

| Seam | Library contract | CLI composition |
| --- | --- | --- |
| Document material | `Renderer.render(document)` | Local Playwright renderer or configured remote endpoint. |
| Raster material | `observeCaptureAgainstBaseline` or `observeRasters` | No foreign-image command; in-place Playwright uses the library seam directly. |
| Retention | `RasterStore` and `RenderCache` | Durable directory or configured remote backend. |

The distinction is intentional: a library accepts injected capabilities; a
binary needs a complete operator workflow, error contract, and acceptance path.

## 5. Cost, speed and signal

The material and placement choices trade different costs:

| Choice | Saves | Pays | Best fit |
| --- | --- | --- | --- |
| In-place raster | reconstruction and a second browser | host-browser identity discipline; repeated screenshots; raster egress if remote review follows | state already reached in a stable, pinned browser, where disclosing the DOM is unacceptable |
| Deferred local document | application rerun; enables render caching | resource closure or equivalent-access discipline, plus local browser cost | browserless acquisition or one pinned local renderer |
| Deferred remote document | pinning the acquisition machine; enables remote fan-out | disclosure of the document and its resources, plus transport; environment-dependent documents require equivalent resource access | shared render service; cross-environment portability only for closed documents |
| Existing raster library input | all acquisition and rendering work | reduced semantic evidence unless the caller supplies it | another trusted capture system already owns pixels and identity |

Renderer identity partitions durable baselines by engine, platform, scale,
fonts, stabilization, and rasterization recipe. Chromium rendering defaults to
`--disable-lcd-text` and `--font-render-hinting=none`; changing the ordered launch
recipe changes identity instead of presenting font rasterization as a component
regression.

## 6. Why this is flexible, and what flexibility costs

The engine is composable because each expensive or host-bound capability arrives
as a value: collector, renderer, store, decoder, and source evidence. A remote
renderer implements the same `Renderer` contract as the local one. An in-place
raster skips that contract because materialization already happened, then joins
the same observation path.

Flexibility costs explicit boundaries:

- A host adapter must preserve lifecycle and name stable subjects.
- A portable document must close over every resource it needs to paint.
- An in-place browser must declare the launch recipe that owns its pixels.
- A baseline store must refuse cross-identity comparison.
- Repeated-render instability must be classified before baseline difference.
- Missing semantic or source evidence reduces the report instead of inventing an
  empty answer.

Those costs are carried by types, artifact validation, identity digests, and
tests. They are not configuration folklore the adopter is expected to remember.
