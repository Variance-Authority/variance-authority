# Add one observation to a Playwright test

Use the test that already reaches the state. By default [Variance
Authority](README.md) uses one bounded `Locator` to retain a document for
**deferred rendering**; in-place capture is explicit when the caller-owned
browser raster is the evidence. Either path returns an observation without
taking over the runner, fixtures, authentication, readiness, or assertions.

## Before you add the observation

The test must already reach a deterministic state in a page with a viewport.
Choose a locator around the behavior under review, not the whole page, and give
it an id that survives a test-title change.

Install the additive helper and the Chromium binary it uses for deferred
rendering:

```bash
npm install --save-dev @variance-authority/playwright-test @playwright/test
npx playwright install chromium
```

## Observe the state

Keep `test` and `expect` imported from the suite's existing Playwright package.
Add the observation after the test's own navigation, actions, and waits:

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

The first ordinary run returns `new`, so `assertUnchanged` fails. That is the
review boundary: no approved baseline exists for `cart/empty` under this render
identity.

## Review, accept, and prove the rerun

Run the focused test in the mode your suite uses to inspect the reached state.
When the bounded candidate is the state you intend to keep, cross Playwright's
explicit update boundary:

```bash
npx playwright test --update-snapshots=all
```

The update run promotes the candidate it painted, returns `unchanged`, and
passes. It does not paint a second unseen image for acceptance. Run the suite
normally once more:

```bash
npx playwright test
```

The same state now returns `unchanged`. A later `changed` result is evidence
against this approved subject; it is not a request to update automatically.

## Go deeper

Read [attribution](attribution.md) when a changed region must resolve to its
component and `file:line`, or [stabilization](stabilization.md) when the state is
not repeatable. The complete fixture, materialization, source, and multi-subject
contracts remain in the
[`@variance-authority/playwright-test` reference](../packages/playwright-test/README.md).
