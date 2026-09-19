# Add Variance Authority to what you already use

Moving a suite off Percy, Chromatic or Argos is not one decision but one per
harness, and the `toHaveScreenshot` assertions that already work are usually
worth keeping. This page takes one harness at a time and says what stays yours,
what you add, what the change buys and what it costs, so you can adopt at a
single boundary instead of rebuilding the workflow around it. For the vendor
tradeoffs in full, see [how it compares](comparison.md) and [where a build gate
fits](gates.md); for the exact APIs, [the surface reference](surface.md).

New here? Start with [your first run](start.md).

Two words repeat below. A **subject** is one named UI state you asked for and
can ask for again, under an id you choose — `cart/empty`, or
`story:checkout--empty`. A **collector** is a module you write that tells a run
which subjects exist and how to reach them; the first two sections below need no
collector, because the test you already have reaches the state itself.

## Alongside `expect(page).toHaveScreenshot()`

Put one observation on one locator while the rest of the suite keeps its
existing screenshot assertions. Both can assert on the same page in the same
test.

**What you keep.** Playwright owns `test`, `expect`, page lifecycle,
navigation, fixtures, retries, and configuration. The package exports neither
`test` nor `expect`.

**What you add.** One dev dependency:

```bash
npm install --save-dev @variance-authority/playwright-test @playwright/test
npx playwright install chromium
```

and one call plus one assertion inside a test you already wrote:

```ts
import { test } from '@playwright/test';
import { assertUnchanged, observe } from '@variance-authority/playwright-test';

test('the cart survives an empty basket', async ({ page }, testInfo) => {
  await page.goto('https://example.test/cart');
  await page.getByRole('button', { name: 'Clear' }).click();

  const observation = await observe(page, page.getByTestId('cart'), testInfo, {
    subjectId: 'cart/empty',
  });

  assertUnchanged(observation);
});
```

`assertUnchanged` is a plain assertion helper, not a replacement for
Playwright's `expect`. A test that wants to decide for itself can read
`observation.verdict` and `observation.regions` instead.

By default the call keeps the document it acquired and repaints it through the
session renderer, which may be local or remote. Configured for in-place capture,
it screenshots the locator in the browser the suite already pins, reads the
subject a second time, refuses it by name if the two readings disagree, and
hands the agreeing image to the same comparison.

**What you gain.**

- a changed region names the component that drew it — and, on Chromium, the
  `file:line` it was declared at — in the failure message, with no image opened;
- an image painted under a different browser, platform, scale factor or font
  stack comes back `incomparable`, naming what differs, rather than as a wall of
  red pixels;
- the document, the pixels and the accessibility tree are three separate
  results, so a role or accessible name that changed without repainting anything
  still comes back `changed`;
- local, remote and in-place capture produce one result shape, and accepting a
  subject promotes the bytes the run under review produced — it never paints a
  second, unseen image.

**What you pay.**

- in-place capture needs an explicit browser launch recipe and at least two
  screenshots;
- deferred capture needs a second paint, and this adapter does not archive
  resource bytes: the renderer must be able to reach equivalent resources;
- the call takes a bounded locator, not a whole-page shot;
- review and baseline retention are yours to operate.

## Alongside Jest or Vitest

**What you keep.** The runner, its `test` and `expect`, the jsdom
lifecycle, mount helpers, and ordinary semantic assertions.

**What you add.** The capture half in the test job, and the render
half — the only place a browser is launched — in the job that paints:

```bash
npm install --save-dev @variance-authority/unit-test jsdom
npm install --save-dev @variance-authority/cli
npx playwright install chromium
```

Then write each state your tests already mount to disk:

```tsx
// src/save-button.test.tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { capture, writeCapture } from '@variance-authority/unit-test';
import { SaveButton } from './save-button.js';

test('save button', async () => {
  const { container } = render(<SaveButton />);
  expect(container.textContent).toBe('Save');

  const artifact = await capture(container, {
    subject: 'button/save',
    viewport: {
      width: 320,
      height: 200,
      deviceScaleFactor: 1,
      colorScheme: 'light',
    },
  });

  await writeCapture('.variance/captures', artifact);
});
```

The unit process launches no browser, produces no screenshot and reaches no
verdict. It writes the markup, the CSS that applies to it, and the bytes of
every resource it references. A later `npx variance run` reads that directory
through `captureCollector`, opens Chromium once, paints every capture the suite
produced, and compares each image against the one you approved.

**What you gain.**

- visual coverage of the components your unit suite already covers, without a
  second Playwright or Storybook suite written for them;
- one pinned renderer for every screenshot in the project, rather than a browser
  in every unit worker;
- a durable handoff that carries the document and its semantic evidence to the
  rendering process;
- the same observation, baseline and report contracts as browser capture.

**What you pay.**

- every external resource must resolve to bytes the capture can archive;
- jsdom has no layout engine, so a changed pixel region comes back unattributed
  rather than joined to the component that drew it;
- the capture directory needs one owner: the test that writes it, the
  once-per-run hook that empties it, and the collector that reads it have to
  agree on the path;
- a pixel verdict exists only after the later rendering process has run.

When you want the browser inside the test instead, use [Vitest browser
mode](start-vitest-browser.md); that is the Playwright composition above, not
this browserless route.

## Alongside an application or static site

**What you keep.** The application or static build, its startup
command, and the explicit list of states worth reviewing.

**What you add.**

```bash
npm install --save-dev @variance-authority/cli @variance-authority/route-collector
npx playwright install chromium
```

and a collector module mapping stable ids to the URLs behind them:

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

With your application already running, `npx variance run --config
variance.config.json` navigates each URL, waits for the configured ready state,
reads the first `roots` selector that matches, and compares what it read.

**What you gain.**

- rendering chosen by the CLI — local, or a remote renderer the whole team
  shares;
- the document and its semantic evidence alongside the pixels;
- source [attribution](attribution.md) when the application carries
  [provenance](attribution.md);
- directory or git-LFS baseline storage behind one store contract.

**What you pay.**

- nothing crawls: the route list comes from your config, a sitemap, or a
  directory of built HTML, and a page reachable only by a link on another page
  is never visited;
- this collector has no cookie, header or storage-state login — for a route that
  exists only after a sign-in, use the Playwright path above and leave the login
  in the test that already performs it;
- each viewport is a distinct planned subject and a distinct render;
- the renderer needs equivalent access to the route's resources, because asset
  hashes are what this collector records by default; set `portable: true` to
  archive the bytes instead.

## Alongside Storybook

**What you keep.** Storybook's build, story index, renderer,
decorators, play functions, and parameters. Nothing reads your `.storybook`
directory.

**What you add.**

```bash
npm install --save-dev @variance-authority/cli @variance-authority/storybook-collector
npx playwright install chromium
```

and a collector beside Storybook:

```js
// variance/storybook.mjs
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  source: { dirs: ['src'] },
});
```

It reads the `index.json` your build writes, opens the preview once, switches
stories over Storybook's own channel, waits for Storybook's own rendered state,
and produces one subject per story.

**What you gain.**

- no addon to install and no `.storybook` rewrite;
- local or remote rendering, chosen by the CLI;
- story ids as baseline ids, prefixed: `story:checkout--empty`;
- the same attribution and report path as every other host.

**What you pay.**

- rendering, storage and review infrastructure remain yours to run;
- cross-browser breadth is limited to the renderer engines you install and
  operate;
- component attribution needs React; a Storybook on another renderer still
  collects documents, pixels and verdicts, and reports no components.

What a hosted product does here that a self-run setup does not — branch
baselines it stores, reviewers it staffs, a managed device fleet — is set out on
[how it compares](comparison.md).

## Start without replacing anything

With no approved baseline, the first durable run reports `new`, never green:
nothing has been approved, so nothing can be unchanged. For a signal before
anyone owns a baseline, set `"retention": "ephemeral"` in the run config — the
run renders two revisions in one process, compares them against each other, and
keeps neither image. A single-revision inspection can report structure,
accessibility, token or locale evidence without reaching a visual verdict at
all.

Choose that composition when the immediate value is attribution or inspection,
and add durable baselines once someone owns the review boundary.
