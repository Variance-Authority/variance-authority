# Carry one unit-test DOM into visual review

Use this path when Jest or Vitest already mounts the state in jsdom. The unit
process serializes one bounded DOM subject; a later CLI process opens Chromium,
paints that capture, and owns the baseline verdict.

## Before you capture

This example uses Vitest with its jsdom environment. The mounted subtree must be
resource-closed: if it references external styles, fonts, or images, provide the
resource resolver described in the package reference.

```bash
npm install --save-dev @variance-authority/unit-test jsdom
npm install --save-dev @variance-authority/cli
npx playwright install chromium
```

Clear capture files once per test run, never once per test:

```js
// vitest.config.mjs
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globalSetup: ['variance/reset.mjs'] },
});
```

```js
// variance/reset.mjs
import { resetCaptures } from '@variance-authority/unit-test';

export async function setup() {
  await resetCaptures('.variance/captures');
}
```

Then write the capture from the existing test:

```ts
// @vitest-environment jsdom
import { test, expect } from 'vitest';
import { capture, writeCapture } from '@variance-authority/unit-test';

test('save button', async () => {
  const button = document.createElement('button');
  button.textContent = 'Save';
  document.body.append(button);

  const artifact = await capture(button, {
    subject: 'button/save',
    viewport: {
      width: 320,
      height: 200,
      deviceScaleFactor: 1,
      colorScheme: 'light',
    },
  });

  await writeCapture('.variance/captures', artifact);
  expect(button.textContent).toBe('Save');
});
```

## Hand the capture to the CLI

```js
// variance/collector.mjs
import { captureCollector } from '@variance-authority/unit-test';

export default captureCollector({ directory: '.variance/captures' });
```

```json
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

`profile: "jsdom"` records where acquisition happened; Chromium still paints
the serialized document in the later process.

## Run the first review loop

Run the unit suite once to produce the capture, then observe it:

```bash
npx vitest run
variance doctor --config variance.config.json
variance run --config variance.config.json
```

The unit test passes after writing the artifact. The first durable Variance
Authority run exits `1` and reports `button/save` as `new`. Inspect its candidate:

```bash
variance report --config variance.config.json --format html > .variance/report.html
```

Accept only that subject, regenerate the capture, and run the comparison again:

```bash
variance accept --config variance.config.json button/save
npx vitest run
variance run --config variance.config.json
```

The final run exits `0` with `button/save` `unchanged`.

## Go deeper

Read [baseline placement](placement.md) when the capture and baseline jobs live
on different machines, or [composition](composition.md) when this result joins a
browser-owned reading. The
[`@variance-authority/unit-test` reference](../packages/unit-test/README.md)
owns resource resolution, [provenance](attribution.md) hooks, Jest setup, capture-file rules, and
the separate value-snapshot boundary.
