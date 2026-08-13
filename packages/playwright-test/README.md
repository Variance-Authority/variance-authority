# @variance-authority/playwright-test

**Requires:** a Playwright test run with an already-opened `Page`, a non-null
viewport, and a browser binary on the machine.

Add a source-aware visual observation to a Playwright test that already knows
how to navigate, authenticate, mount data, and wait for the application. The
test body remains the collector; this package contributes one `variance`
fixture and one `toBeUnchanged` matcher.

Use this integration when the state you need is already easiest to reach in a
Playwright test:

```bash
npx playwright install chromium
```

## Add an observation to a test

Import `test` and `expect` from this package, drive the page as usual, then hand
the fixture a `Locator` for the subtree you intend to review.

```ts
import { test, expect } from '@variance-authority/playwright-test';

test('the cart survives an empty basket', async ({ page, variance }) => {
  await page.goto('https://example.test/cart');
  await page.getByRole('button', { name: 'Clear' }).click();

  const observation = await variance(page.getByTestId('cart'), {
    subjectId: 'cart/empty',
  });

  expect(observation).toBeUnchanged();
});
```

`variance` returns an `Observation`; it does not assert. The matcher is the
standard gate, but your test may also inspect `verdict`, `regions`,
`missingFonts`, or diagnostics before deciding what to do.

The default baseline directory is `.variance/baselines`. Override the worker
fixture when the suite needs another location:

```ts
import { test } from '@variance-authority/playwright-test';

test.use({ varianceBaselines: 'test-artifacts/variance-baselines' });
```

## Establish the first baseline

The first run returns `new`, and `toBeUnchanged` fails. That is intentional: a
subject nobody has approved is not an unchanged subject.

After reviewing the candidate, promote the image with Playwright's existing
snapshot flag:

```bash
npx playwright test --update-snapshots
```

Acceptance promotes the candidate painted by that run; it never paints a
second, unseen image. The observation returned by the acceptance run still
describes what it saw, so rerun the test normally to prove the stored baseline
is found and the matcher passes.

Use an explicit `subjectId` for long-lived baselines. When it is omitted, the id
comes from the test title path; renaming the test then produces `new` instead of
silently comparing against a baseline that may describe another scenario.

## Choose the subject deliberately

The fixture accepts a `Locator`, never a `Page`. A bounded subtree keeps shared
application chrome and unrelated CSS out of the comparison, and gives changed
regions a useful component context.

The fixture acquires the live subtree, then paints the acquired document with
its own renderer rather than calling `locator.screenshot()`. That second paint
is the cost of carrying a renderer identity with the baseline. A run on an
incompatible machine can then report `incomparable` instead of presenting a
font-stack or driver change as a component regression.

## Options and fixtures

### `variance(locator, options)`

| Option | Use it when | Default and boundary |
| --- | --- | --- |
| `subjectId` | The baseline should survive test-title changes. | The test title path. A renamed implicit id becomes `new`. |
| `subjectKind` | The subject is not a navigated route. | `route`. |
| `fonts` | Renderer identity must include an asserted font stack. | Omitted and reported as missing identity evidence. Values are `family/weight/style/hash`. |
| `source` | Failure output should resolve components to `file:line`. | Omitted; regions can still name components. |
| `loading` | The subtree's *fallback* is the state you intend to review. | `false`. Waits for nothing, and throws if the subtree turns out to have settled. |
| `suspenseTimeoutMs` | The subtree legitimately needs longer than five seconds to arrive. | `5000`. `0` skips the wait and keeps the reading. |

### Worker fixtures

| Fixture | Purpose | Default |
| --- | --- | --- |
| `varianceBaselines` | Directory holding durable baselines. | `.variance/baselines` |
| `varianceRenderer` | Renderer shared by one Playwright worker. | A Playwright renderer created and closed by the fixture. |
| `varianceStore` | Baseline and render-cache implementation. | Durable directory store using `varianceBaselines`. |
| `varianceBundle` | Page agent installed before application code runs. | The package's bundled agent. |

Override the worker fixtures only when you are deliberately supplying another
renderer, store, or agent bundle. The public types are
`VarianceWorkerFixtures`, `VarianceFixtures`, and `VarianceOptions`.

The package also exports `bundlePageAgent`, `acquire`, `AGENT`, and
`AGENT_VERSION` for authors building a custom Playwright fixture. Ordinary test
suites should use the provided `test`; the low-level exports do not create a
renderer, store, or acceptance lifecycle on their own.

## A subject still arriving throws

Before the subtree is acquired, the fixture waits for every React Suspense
boundary under the locator to settle. This runs first, ahead of stabilization,
because content that arrives late brings its own images and fonts.

A subtree still showing a fallback when `suspenseTimeoutMs` runs out throws,
naming the open boundaries and the components that wrote them. That is
deliberate, and it is where this integration differs from a collector, which
reports the subject as not collected: `variance` returns an `Observation`, and a
photographed spinner is not a comparison result. A failed assertion is what
reaches the person who can decide which of the two states the test is about.

Pass `loading: true` when the fallback is the subject:

```ts
const observation = await variance(page.getByTestId('cart'), { loading: true });
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
  `source` to `variance` or to `toBeUnchanged`.
- **“variance needs a viewport”:** the Playwright page uses a null viewport.
  Configure a fixed viewport so two runs have a declared size.
- **The matcher lists a large container first:** this integration's docket is
  ordered by changed area and explicitly describes that as displacement, not
  blame. Do not read its ordering as cause-first attribution.
- **“still waiting when it was read”:** the named Suspense boundary never
  resolved. Fix what it awaits, or pass `loading: true` if the fallback is what
  you intend to review.
- **The page agent is missing:** import this package's `test`, not Playwright's
  base fixture, and avoid replacing `varianceBundle` unless the custom bundle is
  installed before navigation.

## Boundaries

This package does not merge Playwright shards into one docket. Playwright's
`--shard` can still run the tests, but each shard owns its own result set.

The matcher and docket are unit-tested, but this fixture has not yet been
driven by a separate real-world Playwright suite. Treat the browser-facing
integration as beta evidence, not an established compatibility claim.

For a Storybook inventory use
[`@variance-authority/storybook-collector`](../storybook-collector). For a map
of served pages use
[`@variance-authority/route-collector`](../route-collector). For two documents
already in hand or a custom renderer/store composition, use
[`@variance-authority/observe`](../observe).
