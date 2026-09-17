<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/vantage

> What a run is saying, while it is still saying it.
>
> Held in a process that outlives the test, so a suite in flight is something to look at rather than something to wait for.

Part of [Variance Authority](https://variance-authority.dev), a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source.

A suite already knows a great deal that nothing outside it can see. Which realms
answered and in what order. Which work began and never finished. That a service
is plainly talking while the test hearing it hears nothing. All of it exists for
the length of one execution, is spent settling waits, and is then discarded —
which is right for a wait, and wrong for anybody trying to understand the suite
from outside it.

```bash
npm install @variance-authority/vantage
```

You do not install it on purpose either. It arrives under
[`@variance-authority/playwright-test`](https://variance-authority.dev/reference/packages/playwright-test), and the
whole of its configuration is one environment variable.

## The question a timeout cannot answer

A test that hangs reports what it *wanted*. Thirty seconds later, in a process
that has already torn down the page, a runner prints the assertion that did not
settle. That is the last thing the failure knows and the first thing you already
knew.

What is missing is the other side: what the execution actually heard before it
stopped, and from whom. Nothing at all is a wiring fact — no listener, or code
that does not announce. A page that spoke while a service did not is a request
that never arrived or never came back. Three announcements and then silence,
with one `vaStart` still open, names the call that is hanging.

None of that survives the test, so nobody can ask it while it is true. This
package is the second reader: a watching process listens, the run reports, and
the signals are held in memory that ends with the watcher instead of memory that
ends with the test.

## Two ends

`openVantage()` is the run's end and reads `VARIANCE_AUTHORITY_VANTAGE`. When it
is unset, `openVantage` returns `undefined` and the suite pays one environment read per worker —
the same bargain heads make, because an instrument nobody asked for must not be
a cost anybody pays.

```ts
import { openVantage } from '@variance-authority/vantage';

const vantage = openVantage();
vantage?.opened('t-1', { title: 'cart adds an item', file: 'cart.spec.ts', worker: 0 });
```

`opened`, `heard`, `remarked`, `noted` and `closed` are the five sentences a run
says on its own account, and every one of them is fire-and-forget. A watcher is an observer and may not
break its subject: a run that failed because the thing looking at it went away
would be worse than no watcher at all.

`attachVantage()`, from `@variance-authority/vantage/attach`, is the watcher's
end and the only half that opens a socket. It is a separate entrypoint for the
reason `@variance-authority/event/collect` is: the two halves ship to different
places.

```ts
import { attachVantage } from '@variance-authority/vantage/attach';

const watching = await attachVantage();
console.error(`VARIANCE_AUTHORITY_VANTAGE=${watching.address}`);

const now = watching.observatory.snapshot();
```

`address` is derived rather than agreed. The port is ephemeral, so a second
watcher on the same machine coordinates with nothing, and the one string
`attachVantage` returns is everything a run needs to be started with.

That same string is also where the watcher answers. A `GET` on it returns the
snapshot as JSON, together with the snapshot handed to the previous reader, so a
process that is not this one can ask what the run is doing:

```bash
curl http://127.0.0.1:54321/
```

One address rather than two. A reader asks on the string it already had to
export for the suite, and there is no second port to keep in step with the
first. Reading and reporting are separated by method rather than by path,
because a participant reports under an execution id it chose and `/` is a
perfectly good one.

The previous snapshot travels with the reading because the reader is a process
that exits. It cannot hold the state a *what changed since I last asked* answer
compares against, and it cannot come back to say it succeeded — so the watcher
rotates as it hands a reading over. One `previous` is shared by every reader,
which is the bargain one MCP connection already makes for its one client.

The medium is [`@variance-authority/wire`](https://variance-authority.dev/reference/packages/wire): one id per
execution, one address to answer on, and the execution in the address rather
than in the body. A run is simply another participant with something to say. The
only difference from a head is which end is the subject — and that this is the
one listener that also answers, which the medium takes as an option so a head or
an event collector stays write-only.

## Reading it

`snapshot()` hands back plain values that will not change again — an observatory
is a mutable thing a socket writes into, and a question about a run must not be
answered from a value that moves while the answer is being written.

Each `WatchedTest` carries its `id`, `title`, `file`, `project`, `worker` and
`state`; everything the execution `heard`, in order, each announcement naming the
realm that made it; what is `pending`, meaning work `vaStart` opened and `vaEnd`
never closed; the listener's `remarks`; what the test itself sent as `notes`; and
the `error`, when there was one.

A test that has stopped to be looked at also carries `waitingAt` — where in the
spec it stopped. That is not a sixth `TestState`: the runner's five words are how
a test *ended*, and a test waiting there has not ended. It is running, and
standing still.

`pending` is exact no matter what was dropped. What is bounded is the list of
announcements, not the tally of work that opened and never closed, and the tally
is the one an unfinished run is actually asked about.

`ObservatoryOptions` takes `tests`, how many tests to keep, defaulting to 200,
`heard`, how many announcements to keep per test, defaulting to 500, and
`notes`, how many of a test's own sends to keep, defaulting to 100. Both
drop from the front and both are counted, because a reader who cannot tell
*nothing was announced* from *the beginning was forgotten* draws the first
conclusion — the one that sends somebody looking for a call that is right there.
`address` is carried into every answer so a reader with nothing to show can name
what to set. `AttachOptions` adds `host`, the interface to listen on, defaulting
to `127.0.0.1`, which is the only kind of address a run will report to.

## Still nothing written down

`@variance-authority/event` takes the position that an announcement is a message
and not a record, and nothing here changes it. There is no report directory, no
file to clean up and no artifact to mistake for evidence later. What changes is
only how long one execution lasts when somebody is watching: the memory holding
it belongs to a process that outlives the test rather than to the test. Stop
that process and the evidence is gone, which is the same bargain at a different
scale.

## Under Playwright, and under an agent

`varianceFixtures` reports for every test in the run. The lifecycle half is
automatic, so a listing has no holes — a test that destructures nothing still
appears — and the announcements arrive from whichever tests took the `events`
fixture.

```bash
VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321 npx playwright test
```

Two things start a watcher, and they hold the run identically. `variance watch`,
from [`@variance-authority/cli`](https://variance-authority.dev/reference/packages/cli), prints that line and stays
up; `variance ask --at <address>` reads it from any other shell.
`variance-authority-mcp --watch`, from
[`@variance-authority/mcp`](https://variance-authority.dev/reference/packages/mcp), does the same over stdio for a
client that speaks it. Both answer `variance_self`, `variance_run_signals`, `variance_waiting` and
`variance_test_signals` about a suite that is still going, from the same
functions over the same snapshot.

## Stopping a run, and letting it go

`waits` is the sixth call, and the one that asks. It says where the test stopped
and then polls this watcher — every `pollMs`, fifty by default, which is a
loopback round trip — until it is told to go on. The run asks and the watcher
answers, so the socket direction never reverses and the rule above survives
intact.

Every way of losing the watcher ends the wait rather than extending it, and each
says which it was: `unwatched` before the first ask, `released` when one that was
there has gone, `expired` when nobody came inside `timeoutMs` — ten minutes by
default — and `continued` when a reader actually said go on. The
failure mode of the thing that stops a test is that the test continues, which is
what makes a call to it safe to commit.

`release(test)` tells one stopped test to go on and `releaseAll()` tells all of
them; each answers what it actually released. The run collects that release
exactly once, however many readers asked for one — the answer to its poll *is*
the release, so a second reader cannot spend the same one on whatever that test
stops at next.

Nothing here knows what a subject is, and none of it is about visual regression.
A suite that never takes a screenshot reports exactly the same sentences as one
that does.

---

**[@variance-authority/vantage](https://variance-authority.dev/reference/packages/vantage)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
