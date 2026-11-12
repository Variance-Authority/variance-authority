# Watch a run that has not finished

Your suite is still running and one test has been on the same line for longer
than it should. [Variance Authority](README.md) can show you what that
test has heard, and from whom, while it is still in flight rather than after
teardown has thrown all of it away.

No suite, and an application you click through by hand? The same watcher lists
the code each of your clicks ran, in the page and in the server: go to [watch an application you use by
hand](#watch-an-application-you-use-by-hand), which needs nothing else on this
page.

The rest of this page covers what a Playwright suite reports while it is still
running. Read it when a test hangs, when you want to
see which work a test started and never finished, or when you want to stop a
test and look at the browser it left open. New here? Start with [your first
run](start.md).

## Start watching

A **watcher** is a small process that outlives your tests. Your suite reports to
it as it goes; you read it from any other shell while the suite is still in
flight. Both halves are `@variance-authority/vantage`, which arrives as a
dependency of the packages below rather than something you install yourself.
Start the watcher first, in its own terminal:

```bash
npm install --save-dev @variance-authority/cli @variance-authority/playwright-test
variance watch
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
variance ask run-signals --at http://127.0.0.1:53393
variance ask test-signals --test f8a1c2d3e4b5 --at http://127.0.0.1:53393
```

A question only the watcher answers reads no `variance.config.json`; `diff`
also reads a finished run, so ask it from your project root. With
`VARIANCE_AUTHORITY_VANTAGE` unset, `varianceFixtures` costs one environment read
per worker and reports nothing, so the fixtures stay in place in CI.

## The question a timeout cannot answer

A test that hangs reports the condition it *waited for*. Thirty seconds later,
in a process that has already torn down the page, the runner prints the
assertion that did not settle. That is the last thing the failure records, and
you already knew it.

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

## What the watcher records about one test

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
- the 200 newest [executions](#watch-an-application-you-use-by-hand) of an
  application used by hand, one per request, or per load and click of a page
  that reports

Past those, entries drop from the front and are counted in `forgotten` and
`forgottenNotes`, so an empty list is never mistaken for a beginning that was
dropped. Dropped executions are counted in the answer that lists the rest.

`pending` is exact regardless: what is bounded is the list of announcements, not
the tally of work that opened and never closed.

## Watch an application you use by hand

You click through an application running on your machine, then ask which code
answered. The watcher lists each thing you did as its own **execution**, with
the functions and branches it ran. For a server alone an execution is one
request. For a page that reports as well, it is one load or one click, and
[the click's listing](#one-click-the-page-and-the-server) holds the page and
the server together. Use the application, then run `variance ask ran` from
the repository it was built from. This is the answer after two requests to a
pricing service:

```bash
variance ask ran --at http://127.0.0.1:53393
```

```
2 execution(s) at http://127.0.0.1:53393.

  b4128c59-ac7c-45d3-abdd-882e39f0e906
  head pricing
      cases/journey-tracing-case/src/pricing.mjs:1 module
      cases/journey-tracing-case/src/pricing.mjs:6 quote entry
      cases/journey-tracing-case/src/pricing.mjs:7 quote if#0/then

  8f7fffec-33b8-4205-978f-ee5209482314
  head pricing
      cases/journey-tracing-case/src/pricing.mjs:1 module
      cases/journey-tracing-case/src/pricing.mjs:6 quote entry
      cases/journey-tracing-case/src/pricing.mjs:10 quote if#0/else
      cases/journey-tracing-case/src/pricing.mjs:11 quote if#0/after

Ran outside any request, or while a module loaded, and so listed under none of them:
  head pricing
      cases/journey-tracing-case/src/pricing.mjs:1 module
```

Executions are listed oldest first, so the request you just made is the last
one. `head pricing` is the process that ran it, under the name that
process chose. Each line below it is a **region** the request ran: a file, a
line, the function declared there, and the branch inside it. Both requests ran
`quote`, and each took a different side of its first `if`. What the process ran
before any request arrived is listed once, at the end.

Four steps get you there: three for the server, and one more for the page.
A **watcher** is a small process on your machine that the application reports
to as it runs, and that you ask from any other shell. Start it in its own
terminal; it prints the address the later steps use:

```bash
npm install --save-dev @variance-authority/cli @variance-authority/sense
variance watch
```

```
  VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:53393
```

Build the application with the probes on. A probe is a counter the build puts
at the start of each function and each branch, which is how a request can say
what it ran. Under Vite that is one plugin, and it needs no test to exist. It
probes what that Vite build compiles: the page's bundle, and the server too
when Vite builds it. A server built another way takes the probes from its own
build;
[the build change](observability.md#journeys-the-flag-and-the-build-change)
has the Rspack and webpack form:

```ts
// vite.config.ts
import { testSelectionProbes } from '@variance-authority/sense/journal';

export default {
  plugins: [testSelectionProbes()],
};
```

Run the request handler inside `enter`, and start the process with two
variables: `VARIANCE_AUTHORITY_JOURNEYS=1` turns the reporting on, and the
address the watcher printed says where it goes. `enter` is what makes one
request one execution. It reads the request's cookies to recognise a request a
test drove, or one a reporting page sent for a click. You set no cookie
yourself, and a request without one is an execution of its own. `head` is the
name this process is listed under:

```ts
import { createServer } from 'node:http';
import { collectJourneys } from '@variance-authority/sense/journey';

const journeys = collectJourneys({ head: 'pricing' });

createServer((request, response) => {
  journeys.enter(request.headers.cookie, () => handle(request, response));
}).listen(3000);
```

```bash
VARIANCE_AUTHORITY_JOURNEYS=1 VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:53393 node dist/server.js
```

A framework that owns the request leaves no handler to wrap. Where the
application already runs Sentry or OpenTelemetry, hand that SDK to the head as
`trace` and leave `enter` out. `openTelemetry(api)` takes the place of
`sentry(Sentry)` for an OpenTelemetry provider:

```ts
import * as Sentry from '@sentry/node';
import { collectJourneys, sentry } from '@variance-authority/sense/journey';

collectJourneys({ head: 'pricing', trace: sentry(Sentry) });
```

The listing is then one execution per trace, named by the trace id, and not
one per request. A browser SDK that propagates its trace to the server makes
that one execution per page view: every request the page made is listed
together. A head handed a `trace` refuses to start without the watcher's
address, unless it [writes parts](across-dimensions.md) for a test run.

### One click, the page and the server

A page built with the same plugin lists what it ran once it calls `reportPage`
with the watcher's address. Each load is then one execution, and so is each
click or submit, with the page listed as `head page`. The page leaves that
execution in a cookie, which the browser sends with each request, so one click
lists the page and the server under one id. Under Vite the address reaches the
page through a `VITE_` variable:

```ts
// src/main.ts
import { reportPage } from '@variance-authority/sense/page';

reportPage(import.meta.env.VITE_VARIANCE_AUTHORITY_VANTAGE);
```

```bash
VITE_VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:53393 npx vite
```

`reportPage` takes any address as a string, so another bundler passes it its own
way. This is the answer after a shop page loaded and its one button was
clicked:

```bash
variance ask ran --at http://127.0.0.1:61427
```

```
2 execution(s) at http://127.0.0.1:61427.

  487f52532da13319b43de5752b33e60b
  head page
      shop.js:1 module
      shop.js:1 render entry
      shop.js:10 addEventListener.arg1 entry

  2672c02f017077310098b5896d03354e
  head pricing
      pricing.js:1 module
      pricing.js:1 quote entry
  head page
      shop.js:1 module
      shop.js:1 render entry
      shop.js:4 ask entry
      shop.js:5 ask await#0
      shop.js:5 ask await#1

Ran outside any request, or while a module loaded, and so listed under none of them:
  head pricing
      pricing.js:1 module
  head page
      shop.js:1 module
```

The first execution is the load. The second is the click: the page ran `ask`,
which sent a request, and the server answered it in `quote`. A click and the
submit it causes are one execution.

`variance ask ran` needs no `variance.config.json`. Rebuild after you edit a
file: a file changed since the build is listed with a count of its regions and no
names, because the names are read from your checkout and would no longer match
what ran.

These limits keep the listing honest:

- A request a test drove is reported to that test's run, and is not listed here.
- Code that runs in the browser is listed only on a page that calls
  `reportPage`. Without it, only a process that calls `collectJourneys` reports.
- A request the page sends after the next click is listed under that later
  click. The click is a boundary and nothing more: the control clicked is not
  recorded.
- A handler the application put on `window` for the capture phase before
  `reportPage` was called runs ahead of the boundary, so what it runs is
  listed under the execution before its click.
- A server joins a click only when the browser sends it the page's cookies. A
  server on another origin that receives none lists its requests as executions
  of their own. A browser keeps cookies per host and not per port, so every
  application on `127.0.0.1` shares them, as two tabs of one application do: a
  request from one can be listed under a click in another.
- A page a test drives is that test's: `reportPage` installs nothing on a page
  whose cookies answer somewhere other than this watcher.
- The request for a document is listed apart from the load it starts: under
  the last execution of the page it replaces, whether a click led to it or a
  reload or a typed address did. A page the back button restores sends its
  requests unjoined until its next click.
- What a click ran is sent as the page starts to leave. What the page runs
  after that is reported by the next page of the same origin as part of its
  load, and is lost when the tab closes.
- A page that leaves with more than about 64 KiB unsent, which takes a few
  hundred modules run in its last half second, can lose it.
- An application started without either variable reports nothing, and
  `reportPage` given no address, or one that is not `http` on this machine,
  installs nothing. Both calls stay in place in production.

`--name <function>` and `--limit <n>` narrow the listing.
The agent skill
[installed with the CLI](agent-workspace-api.md)
has each of them, and what to do about a region that was not named.

## Reading it from an agent

`variance-authority-mcp --watch`, from
[`@variance-authority/mcp`](../packages/mcp), runs the same watcher over stdio
for an agent, and answers from the same snapshot: `variance_run_signals` lists
tests in opening order and marks the one still running, `variance_test_signals`
reads one test's announcements, the realm that sent each, and its unclosed work,
`variance_waiting` lists the tests that have stopped, `variance_ran` lists what an
application used by hand ran, and `variance_diff` answers what changed since the
preceding call.
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
variance ask waiting --at http://127.0.0.1:53393
```

Releasing is the one thing a one-shot shell command cannot do, because the run
lives in the watcher's memory and a CLI process has none. Release from the
process that is watching — over MCP with `variance_continue`, or from your own
watcher with `observatory.release(id)`. A release is spent exactly once, by the
stopped test's next poll, so two readers cannot let one test go twice and a
second release cannot land on whatever that test stops at next.

The test polls and the watcher replies: a stopped test polls for permission to
go on, so every way of losing the watcher ends the wait instead of extending it.
A wait ends in one of four words, and none of them fails the test:

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
