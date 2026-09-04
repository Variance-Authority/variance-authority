# Watch a run that has not finished

A suite in flight knows a great deal that nothing outside it can see. Which
realms answered, and in what order. Which work began and never finished. That a
service is plainly talking while the test listening to it hears nothing. All of
that exists for the length of one execution, is spent settling waits, and is then
discarded — which is right for a wait, and wrong for anybody trying to understand
the suite from outside it.

Vantage holds those signals in a process that outlives the test, so a suite that
has not finished is something to look at rather than something to wait for.

## The question a timeout cannot answer

A test that hangs reports what it *wanted*. Thirty seconds later, in a process
that has already torn down the page, the runner prints the assertion that did not
settle. That is the last thing the failure knows and the first thing you already
knew.

The other half is what the execution actually heard, and from whom:

| What the watcher shows | What it is |
| --- | --- |
| nothing at all | a wiring fact — no listener, or code that does not announce |
| the page spoke and the service did not | a request that never arrived, or never came back |
| three announcements, then silence, with one `vaStart` still open | the call that is hanging, by name |

Distinguishing the first row from the others is why the run listing is read
before the announcements inside any one test. Silence in a test that never
reached the watcher is a different fact from silence in a test that did.

## Two ends, separately installed

`openVantage()` is the run's end. It reads `VARIANCE_AUTHORITY_VANTAGE`; unset,
it returns nothing, and the suite pays one environment read per worker — the
bargain every instrument here makes, because one nobody asked for must not be a
cost anybody pays.

```ts
import { openVantage } from '@variance-authority/vantage';

const vantage = openVantage();
vantage?.opened('t-1', { title: 'cart adds an item', file: 'cart.spec.ts', worker: 0 });
```

`opened`, `heard`, `remarked` and `closed` are the four sentences a run says, and
every one is fire-and-forget. A watcher is an observer and may not break its
subject: a run that failed because the thing looking at it went away would be
worse than no watcher at all.

`attachVantage()`, from `@variance-authority/vantage/attach`, is the watcher's
end and the only half that opens a socket. The port is ephemeral and the address
is derived rather than agreed, so a second watcher on the same machine
coordinates with nothing, and the one string it returns is everything a run needs
to be started with.

**Neither end names the test.** The execution is in the address a report arrives
on, as it is for every participant on [`@variance-authority/wire`](../packages/wire).
A body that named its own test could claim one, and a watcher that believed it
would attribute an announcement to whichever test the body asked for.

The two halves are separately installed and separately versioned. A suite pinned
a minor behind the watcher it reports to is the ordinary case, and a watcher
drops a report it cannot read rather than half-reading it.

## What the watcher holds about one test

| Field | What it answers |
| --- | --- |
| `state` | `running`, or the runner's own word for how it ended |
| `heard` | every announcement in this execution, in the order it was announced |
| `pending` | work `vaStart` opened and `vaEnd` never closed |
| `remarks` | what the listener knew and a wait could not see |
| `forgotten` | announcements dropped from the front to stay bounded |
| `file`, `worker`, `ordinal` | the path already open, the worker, the arrival order |

Every reader takes a **snapshot**. The observatory is a mutable thing a socket
writes into, and a question about a run must not be answered from a value that
changes while the answer is being written.

**`pending` is exact whatever was dropped.** What is bounded is the list of
announcements, not the tally of work that opened and never closed — and that
tally is the one an unfinished run is actually asked about. Both bounds drop from
the front and both are counted, because a reader that cannot tell *nothing was
announced* from *the beginning was forgotten* draws the first conclusion, which
is the one that sends somebody looking for a call that is right there.

## Reading it

`@variance-authority/vantage` arrives under
[`@variance-authority/playwright-test`](../packages/playwright-test), whose
fixtures already include the reporter, and the whole of its configuration is one
environment variable. Over MCP, `variance_run_signals` lists tests in opening
order and marks the one still running, `variance_test_signals` reads one test's
announcements, the realm that sent each, and its unclosed work, and
`variance_diff` answers what changed since the preceding call. The workflow is in
[inspect a live run](agent-live-run.md).

## Nothing is written down

An announcement is a message, not a record. There is no report directory, no file
to clean up, and no artifact to mistake for evidence later. What Vantage changes
is only *how long one execution lasts when somebody is watching*, because the
memory holding it belongs to a process that outlives the test rather than to the
test. Stop that process and the evidence is gone.

Observer failure does not fail the subject, the watcher's state does not alter
the suite's evidence, and none of it reaches a baseline, a verdict or an exit
code. When the question has to survive the process, it belongs to a completed
artifact instead — see [query retained evidence](agent-mcp.md).
