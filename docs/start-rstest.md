# Add visual review to an Rstest suite, with or without a browser

[Rstest](https://rstest.rs) runs a suite two ways, and each one is a different
adoption of visual review.

A test in `jsdom` or `node` has no browser, and should not grow one. It writes a
**capture** — the mounted subtree, the CSS that applies to it, and the bytes of
every resource it references — and a later `variance` process opens Chromium
once and paints every capture the suite produced.

A test under `@rstest/playwright` already has a page. The observation happens
inside the body, the verdict is an assertion Rstest reports, and approval is the
`-u` you already use for its snapshots.

Both run under the same `rstest` binary in the same repository. Choose per
suite, by whether getting into the state needs a browser — not by which one you
adopt first.

## Deferred: capture in jsdom, paint later

### Install

```bash
npm install --save-dev @variance-authority/unit-test jsdom
npm install --save-dev @variance-authority/cli
npx playwright install chromium
```

Rstest's `jsdom` environment loads jsdom from your project; drop it from the
first line if your suite already installs it. The CLI and Chromium are the
render half — a separate process, and the only place a browser is launched.

```js
// rstest.config.mjs
import { defineConfig } from '@rstest/core';

export default defineConfig({
  testEnvironment: 'jsdom',
});
```

### Keep the capture directory in one place

Three files have to agree on where captures go: the test that writes them, the
hook that empties the directory once per run, and the collector the CLI reads it
through. Put the path in a module and import it.

```js
// variance/captures.mjs
export const CAPTURES = '.variance/captures';
```

`writeCapture` refuses a second capture under a subject id that already has one,
so a directory reused across two runs fails on the second. Empty it once, from
Rstest's global setup — never from a test file, where it races the other files
and deletes their captures:

```js
// variance/reset.mjs
import { resetCaptures } from '@variance-authority/unit-test';
import { CAPTURES } from './captures.mjs';

export default async function () {
  await resetCaptures(CAPTURES);
}
```

```js
// rstest.config.mjs
export default defineConfig({
  testEnvironment: 'jsdom',
  globalSetup: ['./variance/reset.mjs'],
});
```

### Capture from a test you already have

```tsx
// src/save-button.test.tsx
import { render, screen } from '@testing-library/react';
import { expect, test } from '@rstest/core';
import { capture, writeCapture } from '@variance-authority/unit-test';
import { CAPTURES } from '../variance/captures.mjs';
import { SaveButton } from './save-button.js';

test('save button', async () => {
  const { container } = render(<SaveButton />);
  expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();

  const artifact = await capture(container, {
    subject: 'button/save',
    viewport: {
      width: 320,
      height: 200,
      deviceScaleFactor: 1,
      colorScheme: 'light',
    },
  });

  await writeCapture(CAPTURES, artifact);
});
```

The test keeps its own assertions and still passes or fails on them. Nothing is
compared here.

`subject` is the id this state is stored, compared and accepted under, and it
has to be unique across the run. `viewport` is required and is resolved in this
process, because the renderer never sees this DOM: the media queries in the
applicable CSS are evaluated against these values and the result is written into
the capture.

Everything the subtree references has to arrive as bytes inside the capture,
because the renderer has no network. If it references an `<img src>`, a `url()`,
or an SVG `<use href>` and you passed no resolver, `capture` throws and names
each one. [Add visual review to the unit tests you already
have](start-unit.md) covers `resolveResource`, the CSS that has to be in the
document, and `retainStyles`.

### Run the loop

```jsonc
// variance.config.json
{
  "project": "design-system",
  "profile": "jsdom",
  "viewport": { "width": 320, "height": 200 },
  "retention": "durable",
  "subjects": { "kind": "collector", "collector": "variance/collector.mjs" },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "fonts": [],
  "report": ".variance/report.json"
}
```

```js
// variance/collector.mjs
import { captureCollector } from '@variance-authority/unit-test';
import { CAPTURES } from './captures.mjs';

export default captureCollector({ directory: CAPTURES });
```

```bash
npx rstest run
npx variance doctor --config variance.config.json
npx variance run --config variance.config.json
```

The suite passes as it did, having written one capture per subject. The first
durable run exits `1` and reports `button/save` as `new` — an image nobody has
approved is not a pass. Look at the candidate, then approve it by id:

```bash
npx variance report --config variance.config.json --format html > .variance/report.html
npx variance accept --config variance.config.json button/save
npx variance run --config variance.config.json
```

The rerun exits `0` and reports `unchanged`. `accept` promotes the image that
run already produced; it renders nothing, so there is no reason to run the suite
again.

What this path cannot give you is attribution. jsdom has no layout engine, so a
changed pixel region is located in the image and not joined to the component
that drew it. If you want that, the state needs a browser — which is the other
half of this page.

## In place: observe the page the test is already driving

### Install

```bash
npm install --save-dev @rstest/playwright playwright
npm install --save-dev @variance-authority/playwright-test
npx playwright install chromium
```

`@rstest/playwright` is Rstest's own fixture package: it launches a browser and
hands the test body a `page`. `@variance-authority/playwright-test` is the
observation, and `/rstest` is the small adapter that reads what Rstest knows
about the test from the values the body destructures.

### Configure the browser once

```js
// rstest.config.mjs
import { defineConfig } from '@rstest/core';
import { definePlaywrightConfig } from '@rstest/playwright/config';
import { CHROMIUM_RASTER_ARGS } from '@variance-authority/playwright-test';

export default defineConfig({
  extends: definePlaywrightConfig({
    launchOptions: { args: [...CHROMIUM_RASTER_ARGS] },
    contextOptions: {
      colorScheme: 'light',
      deviceScaleFactor: 1,
      viewport: { width: 800, height: 600 },
    },
  }),
  testEnvironment: 'node',
});
```

`CHROMIUM_RASTER_ARGS` are the flags that make Chromium's text rasterization
deterministic. Pass them here *and* to the observation below: the browser has to
be launched with them, and the run has to declare that it was, because renderer
identity is what decides whether two images may be compared at all.

`colorScheme` and `deviceScaleFactor` are read off this config by the adapter
and become part of the partition a baseline is stored under. Changing either
puts every subject into a partition where nothing has been approved yet.

### Observe inside the test

```js
// e2e/cart.test.mjs
import { describe, test } from '@rstest/playwright';
import {
  assertUnchanged,
  CHROMIUM_RASTER_ARGS,
  createVariance,
} from '@variance-authority/playwright-test';
import { runOf } from '@variance-authority/playwright-test/rstest';

describe('cart', () => {
  test('empty', async ({ page, task, expect, playwright }) => {
    await page.goto('/cart');

    const variance = await createVariance(page, runOf({ task, expect, playwright }), {
      materialization: {
        kind: 'in-place',
        browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
      },
    });

    try {
      assertUnchanged(await variance.observe(page.locator('#cart')));
    } finally {
      await variance.close();
    }
  });
});
```

Approved images go to `.variance/baselines` unless you pass `baselines`
somewhere else.

`runOf` takes three of the values the body destructures rather than one context,
because Rstest requires a test body's first parameter to be an object pattern —
a non-destructured parameter is refused before the test runs. From those three
it reads everything the run needs to know about itself:

| What it reads | Where it comes from |
| --- | --- |
| the subject id | the suite chain and test name, `cart > empty`, rewritten as `cart/empty` |
| which file owns it | `task.filepath`, relative to the project root |
| colour scheme, scale, base URL | whatever `definePlaywrightConfig` resolved |
| whether this run may approve | `rstest run -u`, and nothing else |

Nothing in the test spells the subject id out. Renaming the test renames the
subject, which is the same trade Rstest's own snapshots make.

### Run the loop

```bash
npx rstest run
```

The first run has no baseline, so the subject is `new`, `assertUnchanged`
throws, and Rstest reports it the way it reports any failure — file, test name,
message and frame:

```
### [F01] cart.test.mjs :: cart > empty

"message": "cart/empty: new — no baseline under this renderer; nothing to compare against"
```

Approve it with the flag you already use for snapshots, then run again:

```bash
npx rstest run -u
npx rstest run
```

The second command promotes the image that run produced; the third compares
against it and passes. An `rstest run` with no flag never approves anything —
Rstest's own default for a snapshot with no baseline is to write one, and this
does not follow it, because the run that produced an image is not the run that
reviewed it.

## Which one to use

| | Deferred | In place |
| --- | --- | --- |
| environment | `jsdom` or `node` | `node` with `@rstest/playwright` |
| browser in the suite | none | one, launched by the fixture |
| what compares | a later `variance run` | the test body |
| what approves | `variance accept <id>` | `rstest run -u` |
| component and `file:line` for a changed region | no | yes |
| getting into state that needs navigation or login | no | yes |

A repository can run both, and the case that proves this path does exactly that:
[`cases/rstest-case`](../cases/rstest-case/README.md) drives the real `rstest`
CLI through both loops and asserts on what each process printed.

## Go deeper

- [baseline placement](placement.md) — `directory`, `lfs` and `remote`, and what
  each costs when the capture and render jobs run on different machines.
- [attribution](attribution.md) — what a report can name a change by, and what
  each hop needs to succeed.
- [stabilization](stabilization.md) — what else changes between two runs of
  the same page, and what is done about it.
- [`@variance-authority/playwright-test`](../packages/playwright-test/README.md)
  — the observation API, and the adapter's own reference.
- [`@variance-authority/unit-test`](../packages/unit-test/README.md) — the
  capture API, framework readers, and `snapshotValue`.
