# Interrogate a test where it stands

A test that has stopped is a page still up, a network still in whatever state
the test put it in, and a suite that will go on when you say so. Two calls in
the spec put it there:

```ts
variance.snapshot(); // send what is here now, keep going
await variance.observe(); // send it, and stand still until an agent says continue
```

`snapshot` is `console.log` for a reader that is not a person. `observe` is
`debugger;` for one. Both arrive at the watcher a
[live run](agent-live-run.md) already reports to, and neither takes a line
number — each reads its own.

## Put the calls in the spec

The `variance` fixture carries both, so a suite that already extends its base
with `varianceFixtures` installs nothing further:

```ts
import { test as base, expect } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

const test = base.extend(varianceFixtures);

test('the cart settles after a second item', async ({ page, variance }) => {
  await page.goto('/cart');
  await page.getByRole('button', { name: 'Add' }).click();
  variance.snapshot('one item in');

  await page.getByRole('button', { name: 'Add' }).click();
  await variance.observe('two items, before the total redraws');

  await expect(page.getByTestId('total')).toHaveText('$24.00');
});
```

Run it with the watcher's address in the environment, as any live run is run:

```bash
VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321 npx playwright test cart.spec.ts
```

## Find the test that is holding still

`variance_waiting` is the only question about a live run whose answer is an
invitation. It is separate from `variance_run_signals` because a stopped test is
not a sixth state — it is running, and standing still — and forty rows of a
listing is where that gets missed.

```text
1 test(s) are waiting to be told to continue.

  the cart settles after a second item — cart.spec.ts — worker 0 [t-1f4c]
    stopped at cart.spec.ts:11:18
    sent:
      cart.spec.ts:7:12   after 3 announcement(s)  one item in
      cart.spec.ts:11:18  after 9 announcement(s)  two items, before the total redraws

Look at whatever you need to — the page is held where it is — then call
`variance_continue` with one of these ids, or with none to release all of them.
```

`after N announcement(s)` places each note in the announcement stream the test
was already producing, so you can read a note against the work either side of
it: this one was sent after the second add had opened and before it closed. The
run does not count its own announcements; the watcher stamps the count it had
when the note arrived.

## Ask the questions the stop was for

While the test stands there, everything else about it answers normally:

| What you want | Call |
| --- | --- |
| What has this test announced, and what opened and never closed? | `variance_test_signals` with the id |
| What has arrived since I last looked? | `variance_diff` |
| What is the rest of the suite doing meanwhile? | `variance_run_signals` |

`variance_run_signals` shows a stopped test with `waiting` in place of its state
and keeps the arrow beside it, because it has not ended:

```text
▸ waiting     the cart settles after a second item — cart.spec.ts — worker 0 — heard 9, pending 1
      stopped at cart.spec.ts:11:18
```

Nothing above changes the run. When you have what you came for:

```text
variance_continue { "test": "t-1f4c" }
→ Released the cart settles after a second item [t-1f4c] from cart.spec.ts:11:18.
```

Call it with no argument to release everything that is waiting. Only MCP offers
it: `variance ask` runs in a process that holds no run, so there would be
nothing in it to release.

## Stop somewhere other than the test body

`observe` stops wherever the test is transitively awaiting it. A helper the test
awaits stops the test:

```ts
import type { Page } from '@playwright/test';
import type { VarianceDesk } from '@variance-authority/playwright-test';

async function checkout(page: Page, variance: VarianceDesk) {
  await page.getByRole('button', { name: 'Checkout' }).click();
  await variance.observe('the card form, before it is filled');
  await page.getByLabel('Card number').fill('4242424242424242');
}

test('checkout takes a card', async ({ page, variance }) => {
  await checkout(page, variance); // stops here
});
```

So does a route handler the page is waiting on, which is how you hold a request
open and look at what the UI does with a reply that has not come:

```ts
test('the totals spinner outlives a slow price call', async ({ page, variance }) => {
  await page.route('**/api/price', async (route) => {
    await variance.observe('price request in flight, nothing answered yet');
    await route.continue();
  });

  await page.goto('/cart');
});
```

A call in a frame nobody awaits — a React effect, a render body, a listener
fired and forgotten — has no await point to stop at. It sends its note and
execution carries on past it. That is not the runner's rule; it is what `await`
means.

## Compare two moments without stopping

Where you want the sequence rather than the pause, `snapshot` alone gives it.
Several in one test arrive in order, and `variance_test_signals` lists them
under the announcements, each with the line it came from and the count standing
when it arrived:

```ts
test('the filter narrows the list', async ({ page, variance }) => {
  await page.goto('/orders');
  variance.snapshot('unfiltered');

  await page.getByRole('combobox', { name: 'Status' }).selectOption('refunded');
  variance.snapshot('refunded only');

  await page.getByRole('button', { name: 'Clear' }).click();
  variance.snapshot('cleared');
});
```

A watcher keeps the most recent hundred notes per test and says how many it
dropped, for the same reason it bounds announcements: a reader who cannot tell
*nothing was sent* from *the beginning was forgotten* draws the first
conclusion.

## What holds while the test stands still

The runner's clock is stopped for the length of the wait and handed back
afterwards, so a test released after two minutes has exactly the budget it had
before anybody looked at it — not a fresh one, and not none.

The wait is bounded. `observe` gives up after ten minutes by default, because
the thing on the other end is a person or an agent and either can walk away:

```ts
await variance.observe('the failing state', { timeoutMs: 60_000 });
```

It answers how the standing ended rather than throwing, since none of the four
endings is a test failure:

| Answer | What happened |
| --- | --- |
| `continued` | a reader called `variance_continue` |
| `unwatched` | nobody was watching, so there was nothing to wait for |
| `released` | the watcher went away mid-wait |
| `expired` | nobody came inside the bound |

Every way of losing the watcher ends the wait rather than extending it. The run
asks and the watcher answers, so a dead watcher is a test that goes on.

## Leave the calls in

With `VARIANCE_AUTHORITY_VANTAGE` unset, `observe` returns `unwatched`
immediately and `snapshot` sends nothing, at the cost of one environment read
per worker. That is what separates the pair from the `debugger;` and `.only`
they stand in for — a spec carrying them runs straight through in CI — and it is
why the call can stay in the test that needed it instead of being written again
by the next person who does.

The producing side is documented in
[`@variance-authority/playwright-test`](../packages/playwright-test/README.md#stop-a-test-where-you-want-to-look-at-it),
the watcher's side in
[`@variance-authority/vantage`](../packages/vantage/README.md), and the two
tools in the
[`@variance-authority/mcp` watch reference](../packages/mcp/README.md#watch-a-suite-that-has-not-finished).
