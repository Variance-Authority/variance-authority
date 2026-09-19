# Interrogate a test where it stands

A failure that will not reproduce by hand is only visible while the test is
still standing in it. You can stop a Playwright test at a line you choose — page up,
network in whatever state the test left it — and look at
that moment from another shell, or hold a request open to see what the UI does
with a reply that has not come.

New here? Start with [your first run](start.md).

Two calls in the spec stop a test there:

```ts
// excerpt — the spec these two lines sit in is below
variance.snapshot(); // send what is here now, keep going
await variance.observe(); // send it, and stand still until an agent says continue
```

`snapshot` behaves like `console.log` for a reader that is not a person;
`observe` behaves like `debugger;` for one. Both report to a **watcher** — a
process that outlives your tests, which you read from another shell while the
suite is still in flight. Neither call takes a line number; each reads its own.

## Start the watcher, then the suite

Something has to be listening before the suite starts: a run in flight leaves no
file behind. Start the watcher in its own terminal:

```bash
npm install --save-dev @variance-authority/cli @variance-authority/playwright-test
npx variance watch
```

It takes an ephemeral loopback port and prints the one line the suite needs:

```
variance-authority is watching. Start the suite with this in its environment:

  VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321
```

An MCP client starts the same watcher over stdio with
`variance-authority-mcp --watch`, from `@variance-authority/mcp`, and it prints
the same assignment with its own address in it. [Inspect a suite while it is
running](agent-live-run.md) sets up both entrances, and [watch a run that has
not finished](vantage.md) covers the watcher on its own.

## Put the calls in the spec

The `variance` fixture provides both, so a suite that already extends its base
with `varianceFixtures` installs nothing further:

```ts
import { test as base, expect } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

const test = base.extend(varianceFixtures);

test('the cart settles after a second item', async ({ page, variance }) => {
  await page.goto('/cart');
  await page.getByRole('button', { name: 'Add' }).click();

  // send the cart as it stands, and carry straight on
  variance.snapshot('one item in');

  await page.getByRole('button', { name: 'Add' }).click();

  // send it, and stand here until an agent says continue
  await variance.observe('two items, before the total redraws');

  await expect(page.getByTestId('total')).toHaveText('$24.00');
});
```

Run it with the address the watcher printed in its environment. An address added
after the workers start belongs to the next run:

```bash
VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321 npx playwright test cart.spec.ts
```

## Find the test that is standing still

Ask the watcher which tests are standing still. Under MCP that is
`variance_waiting`, which lists the stopped tests only, so a test standing still
is not lost among the rows of a full run listing:

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

An **announcement** is a call your application code made to
[`@variance-authority/event`](https://variance-authority.dev/reference/packages/event),
heard by a test that destructures the `events` fixture. `after N
announcement(s)` places each note in that stream, so you can read a note against
the work either side of it: this one was sent after the second add had opened
and before it closed. The watcher stamps the count it had when the note
arrived; the run does not count its own.

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
it: `npx variance ask` runs in a process that owns no run, so there is nothing
in it to release.

## Stop somewhere other than the test body

`observe` stops wherever the test is transitively awaiting it. A helper the test
awaits stops the test:

```ts
import { test as base, type Page } from '@playwright/test';
import { varianceFixtures, type VarianceDesk } from '@variance-authority/playwright-test';

const test = base.extend(varianceFixtures);

async function checkout(page: Page, variance: VarianceDesk) {
  await page.getByRole('button', { name: 'Checkout' }).click();

  // the test stops here, one frame down from the body that awaits it
  await variance.observe('the card form, before it is filled');

  await page.getByLabel('Card number').fill('4242424242424242');
}

test('checkout takes a card', async ({ page, variance }) => {
  await checkout(page, variance); // stops here
});
```

So does a route handler the page is waiting on, which is how you hold a request
open and look at what the UI does with a reply that has not come. This one and
the next use the `test` extended with `varianceFixtures` above:

```ts
test('the totals spinner outlives a slow price call', async ({ page, variance }) => {
  await page.route('**/api/price', async (route) => {
    // the reply is held back for as long as you stand here
    await variance.observe('price request in flight, nothing answered yet');

    await route.continue();
  });

  await page.goto('/cart');
});
```

A call in a frame nobody awaits — a React effect, a render body, a listener that
runs without being awaited — has no await point to stop at. It sends its note
and execution continues past it. That is not the runner's rule; it is what
`await` means.

## Compare two moments without stopping

Where you want the sequence rather than the pause, `snapshot` alone gives it.
Several in one test arrive in order, and `variance_test_signals` lists them
under the announcements, each with the line it came from and the count standing
when it arrived:

```ts
test('the filter narrows the list', async ({ page, variance }) => {
  await page.goto('/orders');

  // three sends and no stops — the sequence is what you are after
  variance.snapshot('unfiltered');

  await page.getByRole('combobox', { name: 'Status' }).selectOption('refunded');

  variance.snapshot('refunded only');

  await page.getByRole('button', { name: 'Clear' }).click();

  variance.snapshot('cleared');
});
```

A watcher keeps the hundred most recent notes per test and reports how many it
dropped, so you can tell *nothing was sent* from *the beginning was forgotten*.

## What stays true while the test stands still

The runner's clock is stopped for the length of the wait and handed back
afterwards, so a test released after two minutes has exactly the budget it had
before anybody looked at it — not a fresh one, and not none.

The wait is bounded. `observe` gives up after ten minutes by default, because
the thing on the other end is a person or an agent and either can leave:

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

Every way of losing the watcher ends the wait rather than extending it: a test
nobody is watching goes on.

## Leave the calls in

With `VARIANCE_AUTHORITY_VANTAGE` unset, `observe` returns `unwatched`
immediately and `snapshot` sends nothing, at the cost of one environment read
per worker. A spec that calls both runs straight through in CI, which is what
separates the pair from the `debugger;` and `.only` they stand in for.

The producing side is in the [`@variance-authority/playwright-test`
reference](https://variance-authority.dev/reference/packages/playwright-test),
the watcher's side in the [`@variance-authority/vantage`
reference](https://variance-authority.dev/reference/packages/vantage), and the
two tools in the [`@variance-authority/mcp`
reference](https://variance-authority.dev/reference/packages/mcp).
