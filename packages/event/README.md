<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/event

> Announce what the code decided, so a test waits for the decision instead of guessing when it was made.

**Variance Authority** is a visual regression toolkit for web interfaces: it
compares a rendered subject against an approved baseline and reports which
component caused each change. This package is one piece of it.

**Requires:** application source you can add a line to, and a driver that
installs a listener for the run. Nothing is announced where no listener is
installed, so a production bundle carries the calls and says nothing.

An **announcement** is three coordinates — `location`, `subject`, `action` — sent
from the point in the code where something was decided. A test names the same
three back and waits for them. That is the whole of the interface: an
announcement says **when**, never **what**, because what is on the screen already
and the ordinary assertion reads it one line later.

```bash
npm install @variance-authority/event
```

## The assertion a screen cannot answer

A test that looks at the screen can only ask *is it there now*. For anything that
appears, that question is answerable by waiting — badly, but answerable. For
anything that **does not** appear, it is not answerable at all: *the modal is not
shown* and *the modal is not shown yet* look identical, and waiting longer makes
the test slower without ever making it true.

So the branch where nothing happens is either asserted after an arbitrary sleep,
or not asserted. It is usually the branch that matters.

What is missing is not evidence on the screen. The screen is the same in both
cases. It is that the code knows it decided, and nothing carries that outward.

```ts
import { vae } from '@variance-authority/event';

declare function shouldUpsell(): Promise<boolean>;
declare function setUpsell(open: boolean): void;

export async function decideUpsell(): Promise<void> {
  const show = await shouldUpsell();
  // At the decision, not at the render: announced from the render it repeats
  // what the screen already says, and the branch that draws nothing announces
  // nothing.
  vae('checkout', 'upsell-modal', 'decided');
  if (show) setUpsell(true);
}
```

Both branches are now assertable, on the first run, with no duration anywhere:

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

`vaStart` and `vaEnd` bound something that takes time on one set of coordinates.
They are a pair rather than two separate moments because *started and never
ended* is a fact a run can report, and *no end arrived* on its own is not.

```ts
import { vaEnd, vaStart } from '@variance-authority/event';

declare function authorize(): Promise<void>;

export async function pay(): Promise<void> {
  vaStart('checkout', 'payment', 'authorizing');
  try {
    await authorize();
  } finally {
    vaEnd('checkout', 'payment', 'authorizing');
  }
}
```

## What it costs where nobody is listening

One property read and a return. `vae` looks for a sink under `EVENT_SINK` on
`globalThis`, finds nothing in production, and returns — which is why these calls
belong in product source rather than in a wrapper a test build swaps in. An
announcement that only exists under test announces the test harness.

Nothing a listener does reaches the code that announced: a sink that throws is
swallowed at the call. The failure that produces is a wait that times out in the
driver, which names what it wanted and everything it did hear.

## Listening, from `@variance-authority/event/collect`

The listening half is a separate entrypoint because it ships somewhere else. A
product bundle imports the announcing half; a driver and a service under test
import `@variance-authority/event/collect`, and nothing that reaches a user does.

Using Playwright, none of this is written by hand — `@variance-authority/playwright-test`
exposes the log as an `events` fixture. What follows is what that fixture does,
for a driver that is not Playwright.

`createEventLog()` returns an `EventLog`: `seen` in arrival order, `pending` for
processes that started and have not ended, `saw` to ask without waiting,
`happened` and `finished` to wait, `record` to feed it, `remark` to add a
sentence its failures should carry, and `close` to fail every outstanding wait at
once. `WaitOptions` takes `timeoutMs`, defaulting to 5000.

A wait resolves against announcements **already heard** before it subscribes, so
`await events.happened(...)` written one line too late still settles. Anything
else would be a race with a stopwatch in it.

`eventCollectorSource()` returns the source a driver evaluates in the page before
navigation, and `EVENT_REPORT` is the name it calls back on. Neither needs a
build step: the page's sink appears underneath an application that already
announces, and it holds what it hears until the channel exists.

## A service that announces too

A process behind the page is not a realm. It outlives every test in the run and
answers several at once, so an announcement leaving it has to name the execution
it belonged to — otherwise one test's wait is settled by another test's decision
and both pass for the wrong reason.

That id is the journey, the same opaque per-execution value
`@variance-authority/sense/journey` already puts on a cookie. `collectEvents()`
installs the process's sink; `enter` runs a request inside its execution, and
everything it announces — including across an `await` — is attributed there.

```ts
import { collectEvents } from '@variance-authority/event/collect';
import { journeyOf } from '@variance-authority/sense/journey';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

declare function handle(request: IncomingMessage, response: ServerResponse): void;

const events = collectEvents();
createServer((request, response) =>
  events.enter(journeyOf(request.headers.cookie), () => handle(request, response)),
).listen(3000);
```

`EventCollectorOptions` takes `head`, the name this service announces under, and
`directory`, where it writes. They default to `VARIANCE_AUTHORITY_HEAD` and
`VARIANCE_AUTHORITY_EVENTS` — the same variables the journey collector reads, so
one environment block configures both. With no directory configured,
`collecting` is false, nothing is installed, and the process announces nothing.
`close` gives the global back.

Announcements are appended as `HeadEventReport` lines, one per line, and a driver
reads them while the run is still going: a test **waits** on these, so a report
drained at teardown would be worth nothing. `watchEventReports(directory, …)`
returns an `EventWatch` — `poll` to look now, `close` to stop — delivering every
complete line once, in order. A line still being written is not a line yet and is
left for the next look. `WatchOptions` takes `intervalMs`, defaulting to 25;
`EVENT_DIRECTORY_VARIABLE` and `EVENT_HEAD_VARIABLE` name the two variables.

An announcement that arrives with no journey on it belongs to no execution.
Those are counted and named in the failure rather than handed to whichever test
was nearby, because a person reading *nothing was announced* while the service is
plainly announcing needs to be told the cookie never reached it.

## Read and act on failures

- **“Nothing was announced at all, by any realm.”** A setup fact, not a product
  defect: either no listener is installed for this execution, or the code that
  decides does not call `vae` yet.
- **A list of announcements that does not include the one you wanted.** The
  coordinates drifted. The list prints in order, so a mistyped `action` is
  visible at a glance.
- **A head announced with no journey.** Its requests are not carrying the
  cookie. Same-origin is the filter, and a second hop must pass the incoming
  cookie on explicitly.
- **A wait that hangs where the announcement plainly happened.** Something is
  listening in a realm the log is not reading, or the process announcing was
  started without a report directory.
