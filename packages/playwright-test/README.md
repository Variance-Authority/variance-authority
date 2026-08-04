# @variance-authority/playwright-test

**Requires:** a Playwright test run — a `Page` the runner has already opened and
your test has already driven — plus a browser binary on the machine, which an
install does not give you:

```bash
npx playwright install chromium
```

One fixture and one matcher. Everything else in this package is the argument for
why they are two things rather than one.

## Why this is cheaper than a collector

`variance run` needs a collector because it has to mount a project's components
and cannot know how — the project's own bundle, its own providers, its own
definition of settled. A Playwright test has navigated, mounted and waited before
the fixture is reached, so **the test body already is the collector.** What is
left is the half this project does own: acquire, render, compare, attribute.

The measured cost of the other path is 341 lines
([`cases/storybook-case/collector/`](../../cases/storybook-case/collector)). The
cost here is an import.

## Usage

```ts
import { test, expect } from '@variance-authority/playwright-test';

test('the cart survives an empty basket', async ({ page, variance }) => {
  await page.goto('https://example.test/cart');
  await page.getByRole('button', { name: 'Clear' }).click();

  const observation = await variance(page.getByTestId('cart'));

  expect(observation).toBeUnchanged();
});
```

`variance` returns an `Observation` rather than asserting, so a test may read the
verdict, the changed regions and the components they landed on before deciding
what to do about them. `toBeUnchanged` is one reading of that value, not the only
one available.

## The subject is a `Locator`, never a `Page`

A subject is a subtree, and the pruning that makes a comparison affordable and a
report assignable needs a bounded one — 1007 CSS rules parsed, 1 reached the
normalizer on the measurement corpus
([ADR-0003](../../docs/context/adr/0003-cruft-removal-and-css-applicability.md)).
Handed a page, pruning has nothing to prune against and every rule the
application loaded enters the comparison.

## The renderer paints the document, and `locator.screenshot()` is not used

The browser is right there and screenshotting it is one line, which is exactly
why the turn is worth marking.

A live-page screenshot has no render identity behind it: nothing painted it that
can say which machine, which scale, which font stack. Deriving that key on the
caller's side is what `Renderer.identityFor` exists to prevent, and the failure it
prevents is not theoretical — a read key and a write key that differ by the scale
factor produce a run that never finds its own baseline above 1x, and reports
`incomparable` forever in a sentence blaming a machine difference that does not
exist.

So the fixture pays to paint the subject a second time, from the document it
acquired. What that buys is a baseline any machine can reproduce **from the
document**, including a pinned one two networks away — the property the whole
retention design rests on
([`packages/remote`](../remote)).

If that trade is the wrong one for a suite, the mode that avoids it is the
ephemeral one: two documents acquired by this test, compared by
[`observePair`](../observe), needing no identity at all because one renderer
painted both.

## `new` fails

Every snapshot matcher in this category writes the first image it sees and
reports green. A subject nobody has approved is not a passing subject; Playwright
has no third outcome, so `toBeUnchanged` fails and names which one it is.

`--update-snapshots` promotes what the run already painted — the candidate is
taken from the render cache, never re-rendered, so the bytes a reviewer approved
and the bytes that became the baseline are one image rather than two nobody
compared ([ADR-0021](../../docs/context/adr/0021-approval-promotes-an-image-that-already-exists.md)).
A cache miss is refused by name instead.

## What it cannot do yet

- **Claim it has run.** The docket is unit-tested
  ([`src/docket.test.ts`](src/docket.test.ts)); the fixture has never been driven
  by a real Playwright suite. What is unexercised is the half with a browser in
  it, which is the half that fails in interesting ways.
- **Rank causes above collateral.** The durable path carries one snapshot, so
  nothing here knows which component was edited and which was merely reflowed.
  The docket is ordered by area — which measures displacement, and which this
  project measured as backwards by 6× — and the failure message says so rather
  than presenting the ordering as blame.
- **Shard.** Playwright's own `--shard` works, because each shard is a worker
  process with its own renderer and store. What does not exist is a merge: N
  shards produce N sets of verdicts and nothing joins them into one docket.
