<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/event

> Announce what the code decided, so a test waits for the decision instead of guessing when it was made.

Part of [Variance Authority](https://variance-authority.dev).

This package compares no images and needs none of the rest of that system. It
gives your application source one call that says *the code has just decided
something*, and gives your test one wait that settles on that call. Use it
wherever a test has to assert the branch in which nothing is drawn: *the modal is
not shown* and *the modal is not shown yet* look the same on screen, so that
branch is usually asserted after an arbitrary sleep, or not asserted. An
**announcement** carries the decision out of the code, and your ordinary
assertion reads the screen one line later, once the decision has arrived.

An announcement is three coordinates — `location`, `subject`, `action` — and no
payload. It says **when**, never **what**. (In Variance Authority a *subject* is
one named UI state you asked for and can ask for again; in these three
coordinates, `subject` is simply what the announcement is about.)

## Requirements

Node 22 or newer, and an ESM project: this package is `"type": "module"` and
ships no CommonJS build. Its only dependency is
[`@variance-authority/wire`](https://variance-authority.dev/reference/packages/wire), which arrives with it.

The examples below drive the waiting half with
`@variance-authority/playwright-test`, which needs Node 22.15 and takes one peer:

| Peer | Range |
| --- | --- |
| `@playwright/test` | `>=1.49 <2` |

Two packages, installed in different places:

```bash
npm install @variance-authority/event
npm install --save-dev @variance-authority/playwright-test @playwright/test
```

The announcing half is a plain dependency because the calls live in application
source and ship with it. The driver half is a devDependency, and nothing that
ships to a user imports it.

## Announce at the decision

`vae(location, subject, action)` is the announcing call, and it is the only
function your product source needs. Put it where the **decision** is made, not
where the consequence renders: announced from the render it repeats what the
screen already says, and the branch that draws nothing announces nothing.

```ts
import { vae } from '@variance-authority/event';

export async function decideUpsell(setUpsell: (open: boolean) => void): Promise<void> {
  const response = await fetch('/api/upsell');
  const { show } = (await response.json()) as { show: boolean };
  vae('checkout', 'upsell-modal', 'decided');
  if (show) setUpsell(true);
}
```

## Wait for it in a test

`varianceFixtures` adds an `events` fixture — the log of everything this test
heard. Name the same three coordinates back, then assert the screen:

```ts
import { expect, test as base } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

const test = base.extend(varianceFixtures);

test('the upsell stays away', async ({ page, events }) => {
  await page.goto('/checkout');
  await events.happened('checkout', 'upsell-modal', 'decided');
  await expect(page.getByRole('dialog')).toBeHidden();
});
```

Both branches are now assertable, on the first run, with no duration anywhere.

No `playwright.config.ts` change is needed for this. The fixture evaluates the
listener in the page before navigation, and a test that never destructures
`events` sets none of it up. Configuration enters only when a service announces
too — see [A service that announces](#a-service-that-announces-too) below.

A wait also settles against announcements **already heard** before it subscribes,
so `await events.happened(...)` written one line too late still resolves.

### What you get

When a wait does not settle, it prints what the run did announce, in order.
Announcements that never came are the point, so read the list for a coordinate
that drifted — here, a mistyped `action`:

```
`checkout / upsell-modal / decided` was never announced within 5000ms
Announced in this execution, in order:
  page  checkout / upsell-modal / deciding (start)
  api  pricing / upsell / quoted
  page  checkout / upsell-modal / decidd
```

The first column is the **realm** that spoke: `page` for the browser document, or
the name a service reports under. An **execution** is one run of one test — the
fixture mints an opaque id for it, and everything announced while it runs answers
to that id and to no other test.

Heard nothing at all, the same failure says so in different words, because that
is a setup fact rather than a product defect:

```
`checkout / upsell-modal / decided` was never announced within 5000ms
Nothing was announced at all, by any realm. Either no listener is installed for this execution, or the code that decides does not call `vae` yet — a wait cannot tell those apart and neither can a timeout.
```

### Assert that something was never announced

There is no negative wait, because a negative has no moment to wait for. Wait for
the announcement **both** branches make, then ask about the branch-specific one
without waiting:

```ts
await events.happened('checkout', 'upsell-modal', 'decided');
expect(events.saw('checkout', 'upsell-modal', 'shown')).toBe(false);
```

## Bound something that takes time

`vaStart` and `vaEnd` put a start and an end on one set of coordinates. A run
that ends with a start unanswered can name the work that never finished, which is
a better failure than a timeout.

```ts
import { vaEnd, vaStart } from '@variance-authority/event';

export async function pay(authorize: () => Promise<void>): Promise<void> {
  vaStart('checkout', 'payment', 'authorizing');
  try {
    await authorize();
  } finally {
    vaEnd('checkout', 'payment', 'authorizing');
  }
}
```

`events.finished(...)` settles only on the `end`; `events.happened(...)` settles
on either phase. `events.pending` is everything that started and has not ended.

## What it costs where nobody is listening

One property read, a `typeof` check and a return. `vae` looks for a **sink** — the
function a listener installs on `globalThis` under `EVENT_SINK` (`__VAE__`) — and
finds nothing in production. That is why these calls belong in product source
rather than in a wrapper a test build swaps in: an announcement that only exists
under test tells you about the test harness.

Nothing a listener does affects the code that announced. A sink that throws is
swallowed at the call, and the failure that produces is a wait that times out in
the driver, printing what it did hear.

## Listen without Playwright, from `@variance-authority/event/collect`

The listening half is a separate entrypoint because it ships somewhere else: a
product bundle imports the announcing half, and a driver or a service under test
imports this one. Under Playwright the `events` fixture is this, already wired.
For any other driver, build the log yourself:

```ts
import { createEventLog } from '@variance-authority/event/collect';

const events = createEventLog();
events.record('page', {
  phase: 'once',
  location: 'checkout',
  subject: 'upsell-modal',
  action: 'decided',
});

console.log(events.saw('checkout', 'upsell-modal', 'decided')); // true
console.log(await events.happened('checkout', 'upsell-modal', 'decided'));
// { phase: 'once', location: 'checkout', subject: 'upsell-modal',
//   action: 'decided', realm: 'page', ordinal: 0 }
```

`createEventLog(options?)` returns an `EventLog`:

| member | signature | what it does |
| --- | --- | --- |
| `seen` | `readonly RecordedEvent[]` | everything heard, in arrival order |
| `pending` | `readonly RecordedEvent[]` | what `vaStart` opened and `vaEnd` has not closed |
| `saw` | `(location, subject, action) => boolean` | whether these coordinates have been announced, asked without waiting |
| `happened` | `(location, subject, action, options?) => Promise<RecordedEvent>` | settles when these coordinates are announced in **any** phase, past or future |
| `finished` | `(location, subject, action, options?) => Promise<RecordedEvent>` | settles only when an `end` closes these coordinates, past or future |
| `record` | `(realm, event) => RecordedEvent` | feed the log one announcement, from a named realm |
| `remark` | `(about, sentence) => void` | a keyed sentence every failure from this log carries; last write for a key wins |
| `close` | `(because?) => void` | fail every outstanding wait at once, and every later one |

`WaitOptions` takes `timeoutMs`, defaulting to 5000. `RecordedEvent` is the
announcement plus `realm` and `ordinal`, its arrival index from 0.

`EventLogOptions` takes `onRecord` and `onRemark`, called as each one arrives
rather than at teardown, so a process watching the run from outside the worker
can ask what a test hanging *right now* has heard. A watcher that throws is
swallowed, as a sink is.

`eventCollectorSource()` returns source for a driver to evaluate in the page
before navigation — source rather than a module, because it has to run before the
application does. It needs no build step and touches nothing in the page: the
sink appears underneath an application that already announces.

## A service that announces too

A process behind the page outlives every test in the run and answers several at
once, so an announcement leaving it has to name the execution it belonged to.
Otherwise one test's wait is settled by another test's decision and both pass for
the wrong reason.

Such a process is a **head**: a realm that is not the browser, announcing under a
name. `collectEvents()` installs its sink, and `enter` runs a request inside the
execution that sent it, so everything that request announces — including across an
`await` — answers to that execution's driver.

```ts
import { collectEvents } from '@variance-authority/event/collect';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const events = collectEvents();

function handle(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'application/json' }).end('{"show":false}');
}

createServer((request, response) =>
  events.enter(request.headers.cookie, () => handle(request, response)),
).listen(3000);
```

Nothing is installed unless `VARIANCE_AUTHORITY_EVENTS` is set. Set it, and the
service's name, in the `webServer` block that starts the process — the driver
reads the same variable to decide whether heads are in play, so one environment
block configures both ends:

```ts
// playwright.config.ts
export default {
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'node ./server.js',
    url: 'http://localhost:3000',
    env: {
      VARIANCE_AUTHORITY_EVENTS: '1',
      VARIANCE_AUTHORITY_HEAD: 'api',
    },
  },
};
```

Any value will do for `VARIANCE_AUTHORITY_EVENTS`; it is a fact about the
environment, not a location. `VARIANCE_AUTHORITY_HEAD` is the name the service
announces under, defaulting to `head`, and it is the same variable
[`@variance-authority/sense/journey`](https://variance-authority.dev/reference/packages/sense) reads, so one block names a
service once.

`EventCollectorOptions` overrides both in code, as `head` and `enabled`. Where the
process is not under a run, `collecting` is false, nothing is installed, and the
call costs an `if`. `close()` gives the global back.

### How an announcement gets home

Nothing is written down. A test **waits** on an announcement, so it is worth
something for the length of one execution and nothing afterwards: no report
directory, no file to clean up, no artifact to mistake for evidence later.

The channel is the cookie the driver already set, and it is not this package's.
[`@variance-authority/wire`](https://variance-authority.dev/reference/packages/wire) carries announcements and coverage
accounts — which regions of source an execution entered — on one medium under one
execution id, and reports only which of the two was speaking. `enter` takes the
request's `Cookie` header, or the pairs a service's own cookie accessor holds,
joined the same way. A request the run did not drive carries neither, and
announces to nobody.

Because the address travels on a cookie, the wire accepts only loopback `http`.
Every send that fails is swallowed, and reads in the driver as a wait that times
out and prints what it did hear.

`listen()`, from `@variance-authority/wire/listen`, is the other end for a driver
that is not Playwright. It hands out one address per execution and calls back with
the execution and a `HeadEventReport` — the three coordinates plus `phase`,
`head`, and `version: 1` — in the order a head said them.

An announcement arriving for an execution no test here owns is counted and named
in the failure rather than handed to whichever test was nearby, so a person
reading *nothing was announced* while the service is plainly announcing is told
where it was answering instead.

## Read and act on failures

- **"Nothing was announced at all, by any realm."** A setup fact: either no
  listener is installed for this execution, or the code that decides does not call
  `vae` yet.
- **A list of announcements without the one you wanted.** The coordinates drifted.
  The list prints in order, so a mistyped `action` is visible at a glance.
- **A head answered for an execution no test here owns.** Its requests are
  carrying a cookie some other execution left. Same-origin is the filter, and a
  second hop must pass the incoming cookie on rather than one it kept.
- **A wait hangs where the announcement plainly happened.** Something is listening
  in a realm the log is not reading, or the process announcing was started without
  `VARIANCE_AUTHORITY_EVENTS`.

---

**[@variance-authority/event](https://variance-authority.dev/reference/packages/event)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
