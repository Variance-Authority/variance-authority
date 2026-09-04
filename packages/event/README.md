<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/event

> Announce what the code decided, so a test waits for the decision instead of guessing when it was made.

An **announcement** is three coordinates — `location`, `subject`, `action` — sent
from the point in the code where something was decided. A test names the same
three back and waits for them. That is the whole of the interface: an
announcement says **when**, never **what**, because what is on the screen already
and the ordinary assertion reads it one line later.

```bash
npm install @variance-authority/event
```

The calls go in application source, and stay there. Nothing is announced where
no listener is installed, so a production bundle carries them and says nothing.

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

`createEventLog()` returns an `EventLog`:

| member | what it is for |
|---|---|
| `seen` | everything recorded, in arrival order |
| `pending` | processes that started and have not ended |
| `saw` | ask without waiting |
| `happened`, `finished` | wait |
| `record` | feed the log |
| `remark` | add a sentence the log's failures should carry |
| `close` | fail every outstanding wait at once |

`WaitOptions` takes `timeoutMs`, defaulting to 5000.

`EventLogOptions` takes `onRecord` and `onRemark`, called as each one arrives.
They exist for a second reader — something watching the run from outside the
worker, such as [`@variance-authority/vantage`](../vantage/README.md). They fire
at the moment of recording rather than at teardown: the question worth asking of
a running suite is what the test hanging *right now* has heard, and an answer
that arrives once it finishes answers a different question. A
watcher that throws is swallowed, for the reason a sink that throws is: an
observer may not break its subject.

A wait resolves against announcements **already heard** before it subscribes, so
`await events.happened(...)` written one line too late still settles. Anything
else would be a race with a stopwatch in it.

`eventCollectorSource()` returns the source a driver evaluates in the page before
navigation; it reports through the carrier
[`@variance-authority/wire`](../wire/README.md) puts in the same page, in either
evaluation order. Neither needs a build step: the page's sink appears underneath
an application that already announces, and it holds what it hears until the
carrier exists.

## A service that announces too

A process behind the page is not a realm. It outlives every test in the run and
answers several at once, so an announcement leaving it has to name the execution
it belonged to — otherwise one test's wait is settled by another test's decision
and both pass for the wrong reason.

`collectEvents()` installs the process's sink. `enter` runs a request inside the
execution that sent it, and everything it announces — including across an
`await` — answers to that execution's driver and no other.

```ts
import { collectEvents } from '@variance-authority/event/collect';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

declare function handle(request: IncomingMessage, response: ServerResponse): void;

const events = collectEvents();
createServer((request, response) =>
  events.enter(request.headers.cookie, () => handle(request, response)),
).listen(3000);
```

### Nothing is written down

An announcement is a message and not a record. A test **waits** on it, so it is
worth something for the length of one execution and nothing afterwards: there is
no report directory, no file to clean up, and no artifact to mistake for evidence
later.

The channel is the cookie the driver already sets, and it is not this package's:
[`@variance-authority/wire`](../wire/README.md) carries announcements and
coverage accounts on one medium under one execution id, and only reports which of
the two was speaking. `enter` takes the request's `Cookie` header, or the pairs a
service's own accessor holds joined the same way; a request the run did not drive
carries neither, and announces to nobody.

That the address is a cookie is why the wire refuses everything but loopback
`http`, and none of it is installed unless `VARIANCE_AUTHORITY_EVENTS` says this
process is under a run. Every send that fails is swallowed, for the reason the
sink swallows a throw: that failure belongs to the driver, where it reads as a
wait that times out and prints what it did hear.

`EventCollectorOptions` takes `head`, the name this service announces under, and
`enabled`, whether to install a sink at all. They default to
`VARIANCE_AUTHORITY_HEAD` and to whether `VARIANCE_AUTHORITY_EVENTS` is set — the
first is the variable the journey collector reads, and the second is read by the
driver too, so one environment block configures both ends. Not under a run,
`collecting` is false, nothing is installed, and the call costs an `if`. `close`
gives the global back.

`listen()`, from `@variance-authority/wire/listen`, is the other end. It hands
out one address per execution and calls back with the execution and the
`HeadEventReport`, in the order a head said them, for whoever asked to hear
`'events'`. The execution is in the address rather than in the body, so a head
repeats nothing it was told and a report cannot claim an execution by writing one
down.

An announcement that arrives for an execution nobody here owns is counted and
named in the failure rather than handed to whichever test was nearby, because a
person reading *nothing was announced* while the service is plainly announcing
needs to be told where it was answering instead.

## Read and act on failures

- **“Nothing was announced at all, by any realm.”** A setup fact, not a product
  defect: either no listener is installed for this execution, or the code that
  decides does not call `vae` yet.
- **A list of announcements that does not include the one you wanted.** The
  coordinates drifted. The list prints in order, so a mistyped `action` is
  visible at a glance.
- **A head answered for an execution no test here owns.** Its requests are
  carrying a cookie some other execution left. Same-origin is the filter, and a
  second hop must pass the incoming cookie on rather than one it kept.
- **A wait that hangs where the announcement plainly happened.** Something is
  listening in a realm the log is not reading, or the process announcing was
  started without `VARIANCE_AUTHORITY_EVENTS`.
