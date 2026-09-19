<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/vantage

> What a run is saying, while it is still saying it.
>
> Held in a process that outlives the test, so a suite in flight is something to look at rather than something to wait for.

Part of [Variance Authority](https://variance-authority.dev), which retains what
a test run knows — what it rendered, which code it entered, what the workspace
exposes — so the next question is answered from the record, not another run.

## What this is for

A test that hangs reports what it *wanted*. Thirty seconds later, in a process
that has already torn down the page, the runner prints the assertion that did not
settle. That is the last thing the failure knows and the first thing you already
knew.

This package gives you the other side, while the test is still stuck there. You
start a small watching process; your suite is told its address through one
environment variable and reports to it as it goes; you `GET` that same address
from any other shell and read a JSON snapshot of what every test has done so
far. Nothing is written to disk, and stopping the watcher loses the run.

You can also stop a test on purpose — `await variance.observe()` in a spec holds
the page exactly where it is until you say go on — and look at the live browser
before releasing it.

## Requirements

Node 22 or newer, and 22.15 for the CLI and the Playwright fixtures below. ESM
only (`"type": "module"`); there is no CommonJS build.
This package has no peer dependencies and imports nothing from any test runner —
it is two ends of an HTTP conversation, and Playwright is only the runner the
ready-made reporting fixtures happen to be written for.

**You normally do not install this package.** It arrives as a dependency of
[`@variance-authority/playwright-test`](https://variance-authority.dev/reference/packages/playwright-test),
[`@variance-authority/cli`](https://variance-authority.dev/reference/packages/cli) and
[`@variance-authority/mcp`](https://variance-authority.dev/reference/packages/mcp). For the workflow
below, install those:

```bash
npm install --save-dev @variance-authority/cli @variance-authority/playwright-test @playwright/test
```

| Package | Why it is here |
| --- | --- |
| `@variance-authority/cli` | `npx variance watch` starts a watcher; `npx variance ask` reads one |
| `@variance-authority/playwright-test` | `varianceFixtures`, which report your run to the watcher |
| `@playwright/test` | the runner those fixtures extend (`>=1.49 <2`) |
| `@variance-authority/event` | only if your application code announces — see *Announcements*, below |

Install `@variance-authority/vantage` directly when you are writing your own
watcher, or reporting from a runner that is not Playwright:

```bash
npm install --save-dev @variance-authority/vantage
```

## Watch a run, start to finish

Three steps, in two shells. No port is agreed in advance: the watcher takes an
ephemeral one and prints the address, and that printed string is the only thing
you carry.

**1. Start the watcher and leave it up.**

```bash
npx variance watch
```

```
variance-authority is watching. Start the suite with this in its environment:

  VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:53393

Ask it, from any other shell, with the same address:

  variance ask self --at http://127.0.0.1:53393

It holds the run in memory and writes nothing down. Stop it and the run is gone.
```

**2. Start the suite with the line it printed**, in a second shell, using that
address rather than the one above:

```bash
VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:53393 npx playwright test
```

The suite needs `varianceFixtures`, and nothing else:

```ts
// tests/fixtures.ts
import { test as base, expect } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

export const test = base.extend(varianceFixtures);
export { expect };
```

Every test in the run appears, including tests that destructure nothing, so the
listing has no holes. With `VARIANCE_AUTHORITY_VANTAGE` unset, `varianceFixtures`
costs one environment read per worker and reports nothing.

**3. Ask, from a third shell or the second one**, with that same address:

```bash
npx variance ask run-signals --at http://127.0.0.1:53393
```

`npx variance ask` reads `variance.config.json` from the working directory before
it answers anything, live questions included, so run it from your project root.

### What you get

`npx variance ask run-signals --at <address>`, against a run in flight:

```
2 test(s) at http://127.0.0.1:53393 — 1 running, 1 passed.

▸ waiting     checkout › pays with a saved card — tests/checkout.spec.ts — project chromium — worker 2 — heard 3, pending 1
      stopped at tests/checkout.spec.ts:41:11
  passed      cart › adds an item — tests/cart.spec.ts — project chromium — worker 0 — heard 0
```

`npx variance ask test-signals --test f8a1c2d3e4b5 --at <address>`, for the one
that is stuck:

```
checkout › pays with a saved card — tests/checkout.spec.ts — project chromium — worker 2 — running

Heard, in order:
     0  page  checkout / card-form / shown
     1  page  checkout / payment / authorising (start)
     2  payments-service  payments / charge / received

Started and never ended:
  page  checkout / payment / authorising

The listener also knows:
  payments-service has announced 1 time(s) in this execution

The test itself sent:
    tests/checkout.spec.ts:41:11  after 3 announcement(s)  before the card form appears

Stopped at tests/checkout.spec.ts:41:11, waiting to be told to continue. Release it with `variance_continue`.
```

Both are printed from the same JSON a plain `GET` returns, so a reader that is
not the CLI gets the whole thing:

```bash
curl "$VARIANCE_AUTHORITY_VANTAGE/"
```

```json
{
  "state": {
    "address": "http://127.0.0.1:53393",
    "tests": [
      {
        "id": "f8a1c2d3e4b5",
        "title": "checkout › pays with a saved card",
        "file": "tests/checkout.spec.ts",
        "project": "chromium",
        "worker": 2,
        "ordinal": 0,
        "state": "running",
        "heard": [
          { "phase": "once", "location": "checkout", "subject": "card-form", "action": "shown", "ordinal": 0, "realm": "page" },
          { "phase": "start", "location": "checkout", "subject": "payment", "action": "authorising", "ordinal": 1, "realm": "page" },
          { "phase": "once", "location": "payments", "subject": "charge", "action": "received", "ordinal": 2, "realm": "payments-service" }
        ],
        "forgotten": 0,
        "pending": [
          { "phase": "start", "location": "checkout", "subject": "payment", "action": "authorising", "ordinal": 1, "realm": "page" }
        ],
        "remarks": ["payments-service has announced 1 time(s) in this execution"],
        "notes": [
          { "at": "tests/checkout.spec.ts:41:11", "note": "before the card form appears", "ordinal": 0, "after": 3 }
        ],
        "forgottenNotes": 0,
        "waitingAt": "tests/checkout.spec.ts:41:11"
      },
      {
        "id": "a1b2",
        "title": "cart › adds an item",
        "file": "tests/cart.spec.ts",
        "project": "chromium",
        "worker": 0,
        "ordinal": 1,
        "state": "passed",
        "heard": [],
        "forgotten": 0,
        "pending": [],
        "remarks": [],
        "notes": [],
        "forgottenNotes": 0
      }
    ],
    "forgotten": 0
  },
  "previous": { "address": "http://127.0.0.1:53393", "tests": [], "forgotten": 0 }
}
```

`previous` is the snapshot handed to whoever read last, so a one-shot command can
answer *what has happened since somebody looked* without holding anything between
invocations. It is one value shared by every reader of that watcher, not one per
reader.

### The fields

| Field | What it is |
| --- | --- |
| `id` | the runner's test id — a retry arrives as a different id |
| `state` | `running`, or the runner's own word for how it ended: `passed`, `failed`, `timedOut`, `skipped`, `interrupted` |
| `heard` | every announcement in this execution, oldest first |
| `pending` | work that started and never ended, exact whatever was dropped |
| `remarks` | what the listener worked out and a wait could not see, keyed and last-write-wins |
| `notes` | what the spec itself sent, from `variance.snapshot()` and `variance.observe()` calls its author placed |
| `waitingAt` | `file:line:column` where this test has stopped, present only while it is stopped |
| `error` | the first four lines of the failure, when there was one |
| `forgotten`, `forgottenNotes` | how many entries were dropped from the front to stay bounded |

Inside `heard` and `pending`:

| Field | What it is |
| --- | --- |
| `realm` | who announced it: `page`, or the name a service reports under |
| `location`, `subject`, `action` | the three coordinates the announcing call used, in the code's own words. Not a Variance Authority subject — one named UI state you asked for and can ask for again; this package never sees one |
| `phase` | `once`, or `start`/`end` for work with a duration |
| `ordinal` | arrival order in this execution, from 0 |

`waitingAt` is not a sixth `state`. A test standing still is running.

### Announcements

`heard`, `pending` and `realm` are empty until your application code announces.
Announcing is `@variance-authority/event`: `vae(location, subject, action)` for a
thing that happened, and `vaStart` / `vaEnd` on the same three coordinates for
work with a duration — anything `vaStart` opened and `vaEnd` never closed is what
lands in `pending`.

```ts
import { vae, vaStart, vaEnd } from '@variance-authority/event';

vaStart('checkout', 'payment', 'authorising');
await authorise();
vaEnd('checkout', 'payment', 'authorising');
vae('checkout', 'card-form', 'shown');
```

A test hears those only if it destructures the `events` fixture, which is what
installs the listener:

```ts
import { expect, test } from './fixtures';

test('pays with a saved card', async ({ page, events }) => {
  await page.goto('/checkout');
  await events.happened('checkout', 'card-form', 'shown');
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 0 });
});
```

A test that takes no `events` fixture still appears in the listing, with `heard`
empty. That distinction is the diagnosis: nothing at all is a wiring fact — no
listener, or code that does not announce — while a page that spoke while a
service did not is a request that never arrived or never came back.

## Stop a test where you want to look at it

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

`snapshot(note?)` sends what is here now and keeps going. `observe(note?, options?)`
sends it and then holds the test — the page still up, the network still whatever
it was — until somebody releases it. Neither takes a line number; both read their
own from the stack. While a test stands still the runner's clock is stopped, and
when it goes on it has exactly the time it had before.

Find and release stopped tests:

```bash
npx variance ask waiting --at http://127.0.0.1:53393
```

```
1 test(s) are waiting to be told to continue.

  checkout › pays with a saved card — tests/checkout.spec.ts — project chromium — worker 2 [f8a1c2d3e4b5]
    stopped at tests/checkout.spec.ts:41:11
    sent:
      tests/checkout.spec.ts:41:11  after 3 announcement(s)  before the card form appears
```

Releasing is the one thing a one-shot shell command cannot do, because the run is
held in the watcher's memory and a CLI process holds no run. Release from the
process that is watching: over MCP with `variance_continue`, or in your own
watcher with `release` (below).

Leave both calls in the spec. With `VARIANCE_AUTHORITY_VANTAGE` unset, `observe`
returns `'unwatched'` immediately and `snapshot` sends nothing, so a spec that
has them runs straight through in CI — which is what separates them from the
`debugger;` and `.only` they stand in for. If you do run a watcher in CI and
nobody ever releases, `observe` returns `'expired'` after ten minutes by default
and the test carries on.

## Write your own watcher

`attachVantage()`, from `@variance-authority/vantage/attach`, is the watching
end and the only half that opens a socket. It returns the address to start a run
with, so you never type a port:

```ts
// watch.ts — run with `node watch.ts`
import { spawn } from 'node:child_process';
import { attachVantage } from '@variance-authority/vantage/attach';

const watching = await attachVantage();

const suite = spawn('npx', ['playwright', 'test'], {
  env: { ...process.env, VARIANCE_AUTHORITY_VANTAGE: watching.address },
  stdio: 'inherit',
});

const every = setInterval(() => {
  const now = watching.observatory.snapshot();
  for (const test of now.tests) {
    if (test.waitingAt === undefined) continue;
    console.log(`${test.title} stopped at ${test.waitingAt}; letting it go`);
    watching.observatory.release(test.id);
  }
}, 500);

suite.on('exit', async () => {
  clearInterval(every);
  await watching.close();
});
```

| On `attachVantage()`'s result | |
| --- | --- |
| `address: string` | the origin a run is started with, and the origin a reader `GET`s |
| `observatory.snapshot(): VantageState` | plain values that will not change again — the shape printed above |
| `observatory.release(test: string): boolean` | let one stopped test go on; `false` if it was not stopped, or was already released |
| `observatory.releaseAll(): readonly string[]` | let everything stopped go on, and answer which tests those were |
| `close(): Promise<void>` | stop listening; the run it held is gone |

A release is spent exactly once, by the run's next poll. Two readers cannot
release one test twice, and a second release cannot land on whatever that test
stops at next.

`AttachOptions` takes `host` (the interface to listen on, default `127.0.0.1`)
and the three bounds below.

## Report from your own runner

`openVantage()` is the run's end. It reads `VARIANCE_AUTHORITY_VANTAGE` and
returns `undefined` when that is unset, or names anything that is not `http:` on
loopback:

```ts
import { openVantage } from '@variance-authority/vantage';

const vantage = openVantage();

vantage?.opened('t-1', {
  title: 'cart adds an item',
  file: 'tests/cart.spec.ts',
  project: 'chromium',
  worker: 0,
});
vantage?.heard('t-1', {
  phase: 'once',
  location: 'cart',
  subject: 'line-item',
  action: 'added',
  ordinal: 0,
  realm: 'page',
});
vantage?.noted('t-1', 'tests/cart.spec.ts:12:5', 'one item in');

const ending = await vantage?.waits('t-1', 'tests/cart.spec.ts:12:5', {
  timeoutMs: 60_000,
  pollMs: 50,
});
// 'continued' | 'unwatched' | 'released' | 'expired'

vantage?.closed('t-1', 'passed');
```

Under `varianceFixtures` all of this is already done for you: the lifecycle half
is automatic, and `variance.snapshot` / `variance.observe` are `noted` and
`waits` with the call site filled in. Call `openVantage()` once per worker
process, not once per test — the Playwright fixture that wraps it is
worker-scoped. Nothing about the id is inspected: it is the string every report
about that test travels under, so give it whatever your runner calls a test.

`opened`, `heard`, `remarked`, `noted` and `closed` are fire-and-forget: each
queues one loopback `POST` behind whatever that endpoint is still sending, and
nothing in your test awaits it or sees it fail. A watcher that went away cannot
break the run it was watching.

`waits(test, at, options?)` is the only call that returns a promise you wait on.
It says where the test stopped, then polls the watcher every `pollMs` (50 by
default, a loopback round trip) until it is told to go on or `timeoutMs` (ten
minutes by default) runs out. It answers in one of four words rather than
throwing, because none of them is a test failure:

| | |
| --- | --- |
| `continued` | a reader released it |
| `unwatched` | nothing was watching, so there was never anything to wait for |
| `released` | the watcher went away mid-wait |
| `expired` | nobody came within `timeoutMs` |

Pass `Infinity` as `timeoutMs` only if you have also lifted your runner's own
timeout.

## Bounds, and what the watcher will not do

`ObservatoryOptions` — passed through `attachVantage` — bounds what one watcher
holds:

| Option | Default | |
| --- | --- | --- |
| `tests` | 200 | tests kept, newest |
| `heard` | 500 | announcements kept per test, newest |
| `notes` | 100 | notes kept per test, newest |
| `address` | the one it is listening on | carried into every answer, so a tool with nothing to show can name what to set. Set it only when something in front of the watcher rewrites the origin a run must use |

Past those, entries drop from the front and are counted: `forgotten` on the run,
`forgotten` and `forgottenNotes` on each test. Every printed answer says how many
were dropped, so an empty list is never mistaken for a beginning that was
forgotten. `pending` is exact regardless — what is bounded is the list of
announcements, not the tally of work that opened and never closed.

There is no authentication. The listener answers anyone who can reach the port,
and loopback is the whole of the access control: `openVantage` refuses any
address that is not `http:` on `127.0.0.1`, `localhost` or `::1`, so a watcher
started with `host` set to a public interface will listen there and no run will
report to it.

Nothing is written down. There is no report directory, no file to clean up and no
artifact to mistake for evidence later; what changes is only how long one
execution lasts while somebody is watching. Stop the watcher and the run is gone.

None of this is about visual regression, and none of it touches a baseline, a
verdict or an exit code. A suite that never takes a screenshot reports exactly
the same sentences as one that does.

## Over MCP

`variance-authority-mcp --watch`, from
[`@variance-authority/mcp`](https://variance-authority.dev/reference/packages/mcp), is the same watcher
over stdio for an agent, and answers from the same snapshot:

| Tool | Answers |
| --- | --- |
| `variance_self` | where this watcher is listening, whether anything has reported, and what to start a suite with |
| `variance_run_signals` | every test that has reported, its state, and how much each has announced |
| `variance_test_signals` | one test's announcements in order, the realm that sent each, and its unclosed work |
| `variance_waiting` | which tests have stopped, where, and what they sent from there |
| `variance_diff` | what changed between this reading and the one before it |
| `variance_continue` | let one stopped test go on, or all of them |

`npx variance ask` answers all but the last from a shell — `self`,
`run-signals`, `test-signals`, `waiting`, `diff` — against a watcher named with
`--at <address>`. `variance_continue` has no `ask` equivalent, for the reason
above.

---

**[@variance-authority/vantage](https://variance-authority.dev/reference/packages/vantage)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
