# Add Variance Authority to what you already use

You can introduce Variance Authority at one boundary without rebuilding the
workflow around it. Keep the runner or host that already reaches the state,
then choose whether it should produce pixels in place or a document for a later
renderer. A document is portable only when it contains the bytes behind every
external reference.

See [`surface.md`](surface.md) for exact APIs and [`comparison.md`](comparison.md)
for managed-product boundaries.

## Alongside `expect(page).toHaveScreenshot()`

Try the observation on one locator while the rest of the suite keeps its
existing screenshot assertions.

**What stays with Playwright.** Playwright owns `test`, `expect`, page lifecycle,
navigation, fixtures, retries, and configuration.

**What Variance Authority adds.**

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

The default deferred path acquires a document and paints it through a separate
local or remote renderer. The explicit in-place path screenshots the locator in
the caller's browser, repeats the capture, refuses disagreement, and hands the
agreeing raster to the same baseline comparison.

**What becomes available.**

- renderer incompatibility is `incomparable`, not a product diff;
- semantic and source evidence can connect a changed region to a component and
  file;
- local, remote, and in-place materialization use one verdict shape;
- acceptance promotes the candidate bytes the run already observed.

**What the team takes on.**

- in-place capture needs an explicit browser launch recipe and at least two
  screenshots;
- deferred capture needs a resource-equivalent renderer and a second paint; the
  Playwright adapter does not archive external resource bytes;
- the integration intentionally supports locator subjects, not whole-page shots;
- review and retention remain workflows the adopter operates.

## Alongside Jest or Vitest

**What stays with the runner.** The runner, its `test` and `expect`, the jsdom
lifecycle, mount helpers, and ordinary semantic assertions.

**What Variance Authority adds.**

```ts
import { test, expect } from 'vitest';
import { capture, writeCapture } from '@variance-authority/unit-test';

test('save button', async () => {
  await writeCapture('.variance/captures', await capture(
    document.querySelector('button')!,
    {
      subject: 'button/save',
      viewport: {
        width: 320,
        height: 200,
        deviceScaleFactor: 1,
        colorScheme: 'light',
      },
    },
  ));

  expect(document.querySelector('button')?.textContent).toBe('Save');
});
```

The unit process writes a versioned, resource-closed document archive and exits.
A later `variance run` process loads those archives through `captureCollector`
and paints them with its configured local or remote browser.

**What becomes available.**

- browserless unit execution;
- one pinned renderer rather than a browser in every unit worker;
- a durable handoff that preserves semantic evidence;
- the same observation, baseline, and report contracts as browser acquisition.

**What the team takes on.**

- external resources must resolve to immutable archived bytes;
- jsdom does not settle layout or pixels; the later browser does;
- capture directories need run-level cleanup and isolation;
- a pixel verdict exists only after the rendering process.

Vitest Browser Mode with a Playwright provider is the Playwright composition, not
this browserless route.

## Alongside an application or static site

**What stays with the application.** The application or static build, its
startup command, and the explicit list of states worth treating as subjects.

**What Variance Authority adds.** A route collector config mapping stable ids to
URLs and widths. The collector navigates, waits for the configured ready state,
and emits a document for the CLI renderer. The renderer must have equivalent
access to the route's resources because this collector records their hashes,
not their bytes.

**What becomes available.**

- operator-selected local or remote rendering;
- document and semantic evidence alongside the pixels;
- source attribution when the application carries provenance;
- directory, LFS, or remote baseline storage behind one store contract.

**What the team takes on.**

- routes are explicit; the collector is not a crawler or sitemap product;
- authentication and state setup belong to the host collector;
- a managed browser and device fleet and a hosted reviewer surface are absent;
- each viewport is a distinct planned subject and render.

## Alongside Storybook

**What stays with Storybook.** Storybook's build, story index, renderer,
decorators, play functions, and parameters.

**What Variance Authority adds.** `@variance-authority/storybook-collector`
beside Storybook. It reads the story index, reuses one preview, applies the story
viewport before mount, waits for Storybook's rendered state, and emits documents.

**What becomes available.**

- no addon or `.storybook` rewrite;
- local or remote rendering chosen by the CLI;
- story ids as stable subject ids;
- the shared attribution and report path.

**What the team takes on.**

- rendering, storage and review infrastructure remain yours;
- automatic hosted branch baselines, assigned reviewers, and discussion threads
  are not part of the collector;
- cross-browser breadth is limited to renderer engines you install and operate.

## Start without replacing anything

With no approved baseline, the first durable observation is `new`, never green.
An ephemeral comparison can instead render two documents in one renderer and
keep no baseline. Single-revision semantic inspections can report structure,
accessibility, token, or locale evidence without claiming a visual regression
verdict.

Choose that composition when the immediate value is attribution or inspection,
and introduce durable raster approval only when the team has an owner for the
baseline and review boundary.
