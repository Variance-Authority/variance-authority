<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/playwright-test

**Requires:** a Playwright test run with an already-opened `Page`, a non-null
viewport, and a browser binary on the machine.

Add a source-aware visual observation to a Playwright test that already knows
how to navigate, authenticate, mount data, and wait for the application. The
test body remains the collector. This package does not export `test` or
`expect`; the suite keeps the runner, fixtures, matchers, and import paths it
already owns.

Use this integration when the state you need is already easiest to reach in a
Playwright test:

```bash
npx playwright install chromium
```

## Add an observation to a test

Keep importing `test` and `expect` from the suite's existing owner. Pass the
opened `Page`, a bounded `Locator`, and Playwright's `TestInfo` to the additive
helper.

```ts
import { test, expect } from '@playwright/test';
import { assertUnchanged, observe } from '@variance-authority/playwright-test';

test('the cart survives an empty basket', async ({ page }, testInfo) => {
  await page.goto('https://example.test/cart');
  await page.getByRole('button', { name: 'Clear' }).click();

  const observation = await observe(page, page.getByTestId('cart'), testInfo, {
    subjectId: 'cart/empty',
  });

  assertUnchanged(observation);
  expect(observation.subject).toBe('cart/empty');
});
```

`observe` creates and closes its renderer around one observation. It returns an
`Observation`; `assertUnchanged` is a plain assertion helper, not a replacement
for Playwright's `expect`. A test may also inspect `verdict`, `regions`,
`missingFonts`, or diagnostics before deciding what to do.

For several observations in one test, keep one renderer alive explicitly:

```ts
import { test } from '@playwright/test';
import { assertUnchanged, createVariance } from '@variance-authority/playwright-test';

test('the cart states', async ({ page }, testInfo) => {
  const variance = await createVariance(page, testInfo, {
    baselines: 'test-artifacts/variance-baselines',
  });
  try {
    assertUnchanged(await variance.observe(page.getByTestId('cart')));
    assertUnchanged(await variance.observe(page.getByTestId('summary')));
  } finally {
    await variance.close();
  }
});
```

## Choose where pixels are made

Deferred document rendering is the default. It repaints the acquired document
through the session renderer, which may be local or remote and may reuse its
render cache. The adapter preserves the acquisition base URL but does not archive
resource bytes, so a remote renderer must be able to reach equivalent resources.

For a browser the suite already pins, capture the caller-owned locator in place.
Configure Chromium with the exported text-rendering arguments, then declare the
same launch recipe to the session:

```ts
import { defineConfig } from '@playwright/test';
import { CHROMIUM_RASTER_ARGS } from '@variance-authority/playwright-test';

export default defineConfig({
  use: { launchOptions: { args: [...CHROMIUM_RASTER_ARGS] } },
});
```

```ts
import { test } from '@playwright/test';
import {
  assertUnchanged,
  CHROMIUM_RASTER_ARGS,
  createVariance,
} from '@variance-authority/playwright-test';

test('the cart states', async ({ page }, testInfo) => {
  const variance = await createVariance(page, testInfo, {
    materialization: {
      kind: 'in-place',
      browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
    },
  });
  try {
    assertUnchanged(await variance.observe(page.getByTestId('cart')));
  } finally {
    await variance.close();
  }
});
```

In-place capture takes at least two screenshots and refuses them when they
disagree before consulting a baseline. It opens no second browser. The declared
headless state and ordered launch arguments enter renderer identity; they must
match the suite's Playwright configuration.

## Establish the first baseline

The first run returns `new`, and `assertUnchanged` fails. That is intentional: a
subject nobody has approved is not an unchanged subject.

After reviewing the candidate, promote the image with Playwright's existing
snapshot flag:

```bash
npx playwright test --update-snapshots=all
```

Acceptance promotes the candidate painted by that run; it never paints a
second, unseen image. The observation returned by the acceptance run still
describes what it saw, so rerun the test normally to prove the stored baseline
is found and the assertion passes.

Use an explicit `subjectId` for long-lived baselines. When it is omitted, the id
comes from the test title path; renaming the test then produces `new` instead of
silently comparing against a baseline that may describe another scenario.

## Choose the subject deliberately

The observation accepts a `Locator`, never an unbounded page. A bounded subtree keeps shared
application chrome and unrelated CSS out of the comparison, and gives changed
regions a useful component context.

The helper always acquires the live subtree and semantic evidence. Deferred mode
then paints the document through a renderer. In-place mode screenshots the live
locator and stamps the raster with the browser identity declared by the suite.
Both modes reach the same baseline comparison and attribution path.

## Options and composition

### `observe(page, locator, testInfo, options)` and `session.observe(locator, options)`

| Option | Use it when | Default and boundary |
| --- | --- | --- |
| `subjectId` | The baseline should survive test-title changes. | The test title path. A renamed implicit id becomes `new`. |
| `subjectKind` | The subject is not a navigated route. | `route`. |
| `fonts` | Renderer identity must include an asserted font stack. | Omitted and reported as missing identity evidence. Values are `family/weight/style/hash`. |
| `source` | Failure output should resolve components to `file:line`. | Omitted; regions can still name components. |
| `loading` | The subtree's *fallback* is the state you intend to review. | `false`. Waits for nothing, and throws if the subtree turns out to have settled. |
| `suspenseTimeoutMs` | The subtree legitimately needs longer than five seconds to arrive. | `5000`. `0` skips the wait and keeps the reading. |

`createVariance` and one-shot `observe` additionally accept `materialization`.
`{ kind: 'deferred' }` is the default. `{ kind: 'in-place', browser,
stabilityChecks }` requires the host browser declaration; `stabilityChecks`
defaults to `2` and cannot lower the check below two captures.

### Optional fixture composition

| Fixture | Purpose | Default |
| --- | --- | --- |
| `varianceBaselines` | Directory holding durable baselines. | `.variance/baselines` |
| `varianceRenderer` | Renderer shared by one Playwright worker. | A Playwright renderer created and closed by the fixture. |
| `varianceStore` | Baseline and render-cache implementation. | Durable directory store using `varianceBaselines`. |
| `varianceBundle` | Page agent installed before application code runs. | The package's bundled agent. |

`varianceFixtures` and `varianceMatchers` are exported as unbound pieces for a
suite that already owns a shared Playwright extension module. Compose them into
that module's existing `test` and `expect`; this package never exports either
symbol. Override the worker fixtures only when the suite deliberately supplies
another renderer, store, or agent bundle. The public types are
`VarianceWorkerFixtures`, `VarianceFixtures`, and `VarianceOptions`.

The package also exports `bundlePageAgent`, `acquire`, `AGENT`, and
`AGENT_VERSION` for authors building a custom Playwright fixture. Ordinary test
suites should use `observe` or `createVariance`; the low-level exports do not
create a renderer, store, or acceptance lifecycle on their own.

## A subject still arriving throws

Before the subtree is acquired, the integration waits for every React Suspense
boundary under the locator to settle. This runs first, ahead of stabilization,
because content that arrives late brings its own images and fonts.

A subtree still showing a fallback when `suspenseTimeoutMs` runs out throws,
naming the open boundaries and the components that wrote them. That is
deliberate, and it is where this integration differs from a collector, which
reports the subject as not collected: `observe` returns an `Observation`, and a
photographed spinner is not a comparison result. A failed assertion is what
reaches the person who can decide which of the two states the test is about.

Pass `loading: true` when the fallback is the subject:

```ts
import { test } from '@playwright/test';
import { observe } from '@variance-authority/playwright-test';

test('the cart is reviewed while it loads', async ({ page }, testInfo) => {
  const observation = await observe(page, page.getByTestId('cart'), testInfo, {
    loading: true,
  });
});
```

The declaration is checked in both directions: a subtree declared as a loading
capture that turns out to have settled throws as well, because a declaration
that outlived its subject is the same nondeterminism from the other side. The
decision is
[ADR-0037](../../docs/context/adr/0037-a-subject-still-arriving-is-refused.md).

## Read and act on failures

- **`new`:** no baseline exists for this subject id. Review and run once with
  `--update-snapshots`, then rerun normally.
- **`incomparable`:** a baseline exists under another renderer identity. Align
  browser, platform, scale, and asserted fonts instead of accepting the wall of
  changes.
- **Changed regions name components but no files:** pass a `SourceIndex` as
  `source` to `observe`, `session.observe`, or `assertUnchanged`.
- **“variance needs a viewport”:** the Playwright page uses a null viewport.
  Configure a fixed viewport so two runs have a declared size.
- **The assertion lists a large container first:** this integration's docket is
  ordered by changed area and explicitly describes that as displacement, not
  blame. Do not read its ordering as cause-first attribution.
- **“still waiting when it was read”:** the named Suspense boundary never
  resolved. Fix what it awaits, or pass `loading: true` if the fallback is what
  you intend to review.
- **The page agent is missing:** use `observe`, `createVariance`, or compose
  `varianceFixtures`; avoid replacing the bundle unless the custom bundle is
  installed in both the current document and future navigations.

## Boundaries

This package does not merge Playwright shards into one docket. Playwright's
`--shard` can still run the tests, but each shard owns its own result set.

For a Storybook inventory use
[`@variance-authority/storybook-collector`](../storybook-collector). For a map
of served pages use
[`@variance-authority/route-collector`](../route-collector). For two documents
already in hand or a custom renderer/store composition, use
[`@variance-authority/observe`](../observe).
For browserless Jest or Vitest acquisition followed by a later renderer, use
[`@variance-authority/unit-test`](../unit-test).
