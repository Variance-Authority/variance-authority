# Watch a run that has not finished

Your suite is still running and one test has been on the same line for longer
than it should. [Variance Authority](README.md) can tell you what that
test has heard, and from whom, while it is still in flight rather than after
teardown has thrown all of it away.

This page covers a different half of the same problem: what a Playwright suite is
saying while it is still running. Read it when a test hangs, when you want to see
which work a test started and never finished, or when you want to stop a test and
look at the browser it left open. New here? Start with [your first
run](start.md).

## Start watching

A **watcher** is a small process that outlives your tests. Your suite reports to
it as it goes; you read it from any other shell while the suite is still in
flight. Both halves are `@variance-authority/vantage`, which arrives as a
dependency of the packages below rather than something you install yourself.
Start the watcher first, in its own terminal:

```bash
npm install --save-dev @variance-authority/cli @variance-authority/playwright-test
npx variance watch
```

It takes an ephemeral port and prints the one line the suite needs:

```
variance-authority is watching. Start the suite with this in its environment:

  VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:53393
```

Your suite reports through `varianceFixtures`, and nothing else:

```ts
// tests/fixtures.ts
import { test as base, expect } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

export const test = base.extend(varianceFixtures);
export { expect };
```

Start the suite in a second terminal with the address the watcher printed, then
ask the watcher from a third:

```bash
VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:53393 npx playwright test
```

```bash
npx variance ask run-signals --at http://127.0.0.1:53393
npx variance ask test-signals --test f8a1c2d3e4b5 --at http://127.0.0.1:53393
```

`npx variance ask` reads `variance.config.json` from the working directory before
it answers, so run it from your project root. With
`VARIANCE_AUTHORITY_VANTAGE` unset, `varianceFixtures` costs one environment read
per worker and reports nothing, so the fixtures stay in place in CI.

## The question a timeout cannot answer

A test that hangs reports what it *wanted*. Thirty seconds later, in a process
that has already torn down the page, the runner prints the assertion that did not
settle. That is the last thing the failure knows and the first thing you already
knew.

The watcher answers the other half: what the test actually heard, and from whom.
An **announcement** is a call your application code made to
[`@variance-authority/event`](../packages/event) — `vae(location, subject,
action)` for something that happened, `vaStart` / `vaEnd` on the same three words
for work with a duration. Those three words are the announcing code's own
coordinates; the `subject` there is not a Variance Authority subject, and this
half of the toolkit never sees one. A test hears announcements only if it
destructures the `events` fixture. Each announcement names the **realm** it came from: `page` for the
browser, or the name a backend service reports under.

| What you see | What it means |
| --- | --- |
| The test is not in the listing at all | The suite is not reporting to this watcher. `VARIANCE_AUTHORITY_VANTAGE` was unset, or was set after the workers started, in which case it belongs to the next run. |
| The test is listed and `heard` is empty | A wiring fact, not a stall: the test takes no `events` fixture, or the code on that path announces nothing. |
| Announcements from realm `page`, none from the service | A request that never arrived, or never came back. |
| Announcements, then silence, with an entry in `pending` | The call that is hanging, named by the three words `vaStart` opened it with. |
| `waitingAt` is set on the test | The test stopped on purpose, at a `variance.observe()` call its author placed, and is holding the page until somebody releases it. |

Read the run listing before the announcements inside any one test. Silence in a
test that never reported to the watcher is a different fact from silence in a
test that did.

## Report from a runner that is not Playwright

`varianceFixtures` does all of this for you. If your suite runs under something
else, call the reporting end yourself. `openVantage()` reads
`VARIANCE_AUTHORITY_VANTAGE` and returns `undefined` when it is unset, or when it
names anything that is not `http:` on loopback:

```ts
import { openVantage } from '@variance-authority/vantage';

const vantage = openVantage();
vantage?.opened('t-1', { title: 'cart adds an item', file: 'cart.spec.ts', worker: 0 });
vantage?.closed('t-1', 'passed');
```

Call `openVantage()` once per worker process, not once per test. The id is never
inspected — it is the string every report about that test travels under, so pass
whatever your runner calls a test. `opened`, `heard`, `remarked`, `noted` and
`closed` are fire-and-forget: nothing in your test awaits them, and a watcher
that went away cannot fail the run it was watching.

`attachVantage()`, from `@variance-authority/vantage/attach`, is the watching end
and the only half that opens a socket. It takes an ephemeral port and returns the
address to start a run with, so two watchers on one machine never collide and you
never type a port. One watcher tracks one run; start a second watcher for a second
suite.

The two halves are separately versioned, and a suite pinned a minor behind the
watcher it reports to is the ordinary case. A watcher drops a report it cannot
read rather than half-reading it.

## What the watcher knows about one test

| Field | What it answers |
| --- | --- |
| `state` | `running`, or the runner's own word for how it ended: `passed`, `failed`, `timedOut`, `skipped`, `interrupted` |
| `heard` | every announcement this test heard, oldest first |
| `pending` | work `vaStart` opened and `vaEnd` never closed |
| `remarks` | what the listener worked out and a wait could not see, such as how often a given realm has announced |
| `notes` | what the spec's author sent from a `snapshot` or `observe` call, and the `file:line` it was sent from |
| `waitingAt` | the `file:line:column` where this test has stopped, present only while it is stopped |
| `error` | the first four lines of the failure, when there was one |
| `forgotten`, `forgottenNotes` | entries dropped from the front to stay bounded |
| `id`, `file`, `project`, `worker`, `ordinal` | the runner's test id (a retry arrives as a different id), the spec file, the Playwright project, the worker, the arrival order |

`waitingAt` is not a sixth `state`. A test standing still is running.

Every read returns a snapshot: plain values that will not change again, so an
answer about a run in flight cannot shift while you are reading it.

One watcher keeps:

- the 200 newest tests
- per test, the 500 newest announcements
- per test, the 100 newest notes

Past those, entries drop from the front and are counted in `forgotten` and
`forgottenNotes`, so an empty list is never mistaken for a beginning that was
dropped.

`pending` is exact regardless: what is bounded is the list of announcements, not
the tally of work that opened and never closed.

## Reading it from an agent

`variance-authority-mcp --watch`, from
[`@variance-authority/mcp`](../packages/mcp), runs the same watcher over stdio
for an agent, and answers from the same snapshot: `variance_run_signals` lists
tests in opening order and marks the one still running, `variance_test_signals`
reads one test's announcements, the realm that sent each, and its unclosed work,
`variance_waiting` lists the tests that have stopped, and `variance_diff` answers
what changed since the preceding call.
The workflow is in [inspect a live run](agent-live-run.md).

## Stop a test where you want to look at it

Two calls on the `variance` fixture put a test at your disposal.
`variance.snapshot(note?)` sends what is here now and keeps going;
`variance.observe(note?)` sends it and then pauses the test — page still up,
network still whatever it was — until somebody releases it. Neither takes a line
number; both read their own from the stack.

```ts
import { expect, test } from './fixtures';

test('the cart settles', async ({ page, variance }) => {
  await page.getByRole('button', { name: 'Add' }).click();
  variance.snapshot('one item in');

  await page.getByRole('button', { name: 'Checkout' }).click();
  await variance.observe('before the card form appears');

  await expect(page.getByTestId('cart')).toBeVisible();
});
```

While a test stands still the runner's clock is stopped, and when it goes on it
has exactly the time it had before. Find the stopped tests from a shell:

```bash
npx variance ask waiting --at http://127.0.0.1:53393
```

Releasing is the one thing a one-shot shell command cannot do, because the run
lives in the watcher's memory and a CLI process has none. Release from the
process that is watching — over MCP with `variance_continue`, or from your own
watcher with `observatory.release(id)`. A release is spent exactly once, by the
stopped test's next poll, so two readers cannot let one test go twice and a
second release cannot land on whatever that test stops at next.

The run asks and the watcher answers: a stopped test polls for permission to go
on, so every way of losing the watcher ends the wait instead of extending it. A
wait ends in one of four words, and none of them fails the test:

| | |
| --- | --- |
| `continued` | a reader released it |
| `unwatched` | nothing was watching, so there was never anything to wait for |
| `released` | the watcher went away mid-wait |
| `expired` | nobody came within the timeout, ten minutes by default |

Leave both calls in the spec. With `VARIANCE_AUTHORITY_VANTAGE` unset, `observe`
returns `'unwatched'` immediately and `snapshot` sends nothing, so a spec that
has them runs straight through in CI — which is what separates them from the
`debugger;` and `.only` they stand in for. The spec-side calls and the tools that
find and release a stopped test are in [interrogate a test where it
stands](agent-interrogate.md).

## Nothing is written down

There is no report directory, no file to clean up, and no artifact to mistake for
evidence later. The memory that keeps a run belongs to the watcher; stop the
watcher and the run is gone.

There is also no authentication. The watcher answers anyone who can connect to
port, and loopback is the whole of the access control: `openVantage` refuses any
address that is not `http:` on `127.0.0.1`, `localhost` or `::1`, so a watcher
bound to a public interface will listen there and no run will report to it.

None of this changes a baseline, a comparison result or an exit code, and a suite
that never takes a screenshot reports exactly the same sentences as one that
does. When the
question has to survive the process, it belongs to a completed artifact instead —
see [query retained evidence](agent-mcp.md).
