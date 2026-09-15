# Connect a harness the shipped adapters do not know

Use a custom collector when your application already has a deterministic harness
but its subjects are neither Playwright tests, Storybook stories, served routes,
nor unit captures. The harness keeps ownership of mounting, fixtures, teardown,
and readiness. Its adapter returns a shared render document or a named refusal
for every planned subject.

## Before you write the adapter

Choose a shipped integration whenever one already owns the state. A custom
collector is application code: it must turn the harness's reading into the
`Collected` contract and keep expensive renderer or browser lifetimes outside a
per-subject call.

This path uses the CLI's review and approval workflow:

```bash
npm install --save-dev @variance-authority/cli
npx playwright install chromium
```

## Wrap the existing harness

Suppose `openHarness()` returns the project adapter that already knows how to
produce a `Collected` result for a planned subject. The collector module is only
the ownership seam:

```js
// variance/collector.mjs
import { openHarness } from './harness.mjs';

export default async function collector({ plan }) {
  if (!plan) throw new Error('this collector requires an explicit subject plan');
  const harness = await openHarness();

  return {
    async plan() {
      return plan;
    },
    async collect(subject) {
      return harness.collect(subject);
    },
    async close() {
      await harness.close();
    },
  };
}
```

`harness.collect(subject)` returns either `{ ok: true, document }` with optional
semantic and source evidence, or `{ ok: false, because }`. It does not drop a
subject it cannot read.

Name the initial state in the CLI config:

```json
{
  "project": "checkout-ui",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": {
    "kind": "list",
    "ids": ["checkout/empty"],
    "collector": "variance/collector.mjs"
  },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "fonts": [],
  "report": ".variance/report.json"
}
```

## Run the first review loop

```bash
variance doctor --config variance.config.json
variance run --config variance.config.json
variance report --config variance.config.json --format html > .variance/report.html
```

The first successful durable run exits `1` and reports `checkout/empty` as
`new`. Review the candidate in `.variance/report.html`, then promote only the id
you inspected and rerun:

```bash
variance accept --config variance.config.json checkout/empty
variance run --config variance.config.json
```

The rerun exits `0` with `unchanged`. The CLI promotes the candidate produced by
the reviewed run; the collector does not implement a second acceptance path.

## When the material is already in hand

If the integration already owns a render document or raster, renderer, store,
reporting, and an explicit candidate-review-promote boundary, use
`@variance-authority/observe` below the CLI. It compares and returns `new`,
`changed`, `unchanged`, `ignored`, or `incomparable`; it deliberately supplies no
approval command or exit code.

## Go deeper

Read [composition](composition.md) to decide which evidence belongs in that
pipeline. The complete adapter shape is in the
[`@variance-authority/cli` reference](../packages/cli/README.md), and the
lower-level document and raster entrypoints are in the
[`@variance-authority/observe` reference](../packages/observe/README.md).
