# Observability contracts: what a run keeps beyond pass or fail

[**Variance Authority**](README.md) renders your **subjects** — a story, a route, a fixture,
or a value — compares each against its baseline, and records what changed and
why. A **run** is one execution of `variance run`: it plans the subjects,
captures each one, compares it against its baseline, and writes a report built
on one bit per subject, pass or fail. That bit is the whole of what a report
conventionally carries about an execution that knew a great deal more: which
elements it addressed, which components rendered, which instance scheduled each
render, and which branch a service took while the page was waiting on it. All of
it exists for a few milliseconds, and teardown is normally the end of it.

The cost is not paid when a test fails. It is paid afterwards, when the only
question anyone can ask is the one somebody already wrote down. `Unable to find
element` names the question. It does not name the button, the component that
owned it, the code that put it there, or the update that removed it — and the
process that knew all four has exited by the time the line is printed.

## What this page means by the word

Not metrics, logs and traces off a production system, and nothing here wires
into an APM. Observability here is narrower and local: **what one test run
retains after teardown, and what you may conclude from it.** The mechanism is
the one you already know — this is distributed tracing with the **driver**, the
process that runs your suite, as the collector — but the traced thing is a test
execution rather than a user request, the retention is a file rather than a
backend, and the consumer is the next run rather than a dashboard.

The **contracts** in the title are the promises attached to that retained data,
and there are two parties:

- **What the run promises you.** An absence is never reported as a measurement:
  a reading nobody took is missing from a report's field list rather than
  present and zero. A cross-instrument answer joins on identities both producers
  emitted, or it refuses and names the half that was missing.
- **What you promise the run.** Every declaration you make about your system —
  most of all a **head**, below — is checked, not trusted.

Breakage is not an exception and not a warning you can ignore. When either side
fails, the run marks every observation incomplete, writes what it saw anyway,
and refuses to narrow the next run: `variance run --since` then runs the whole
suite and prints the reason. Nothing here reaches a baseline or an exit code —
your suite still passes and fails on the assertions you wrote.

## Do you have to turn any of this on

Some of it is a flag, some of it is a change to your application build, and one
part is work in a service you own.

| What you get | What it costs you |
| --- | --- |
| Attribution on captured subjects — the component that owned a node, the JSX coordinate that wrote it | Nothing for React: the name is on the fiber. Every other framework needs the build step [composition](composition.md) describes. |
| Attention evidence — which elements a test addressed — in a unit or Playwright suite | Install [Eyes](eyes.md) and call `watch` once from your setup file. |
| A live view of a run that has not finished | Nothing to install: [Vantage](vantage.md) arrives under the Playwright integration and is configured by one environment variable. |
| **Journeys** — which regions of source each subject entered, and the report's `regions` field | A flag **and** a build change. Both, or you get neither. |
| A service's own crossings folded into the same record | The build change again, in that service, plus an environment block and one line where requests already pass. |

The flag is `tests: true` in the Storybook collector's options, or
`use: { varianceExecution: true }` in `playwright.config.ts`. The build change
is `testSelectionProbes()` from `@variance-authority/sense/journal` in the Vite
config that bundles your product source. The flag alone records nothing: with
`tests` on and no probes in the preview, the run prints one line to stderr
saying so and continues, and the next `--since` runs everything.

That pair is one switch with two consequences, worth knowing before you leave
one half out. The same journal read drives the **journey** record *and* the
`regions` field on every subject in the report — so a build without probes costs
you two sections, not one. [The lexicon](lexicon.md) lists `regions` among the
fields that are absent rather than empty when the reading was never taken.

**Your test does not change.** Same queries, same expectations, same pass and
same fail; what the run leaves behind is what changes.

## The record, rather than the breakpoint

None of this is secret. Open dev tools on a live page and every one of those
facts is reachable: the component that produced a node, the update that scheduled
a render, the branch a module took. Three conditions have to hold for that to
work — the page is running, execution is stopped, and a person is watching. In
CI none of the three holds, and for anything reading a result an hour later none
of them ever will.

So the record is taken while the page is alive and kept once it is gone.

## Attribution is copied before it can be destroyed

React removes its Fiber pointer from a DOM node when the node unmounts. A click
handler that removes the element it fired on has destroyed that element's
[attribution](attribution.md) before the test's next statement runs. The information is not hidden
and not expensive — it is gone, between two adjacent lines of the test file,
which is why a retry, a screenshot, or a trace replayed afterwards all arrive
too late for it.

[Eyes](eyes.md) — the package `@variance-authority/eyes`, unrelated to the
commercial product of the same name — listens on `document` in the capture
phase, ahead of React's delegated
handler on the root container, and copies the owner chain, the props digest at
each boundary, the authoring component and the JSX coordinate into a plain value
in that same synchronous turn. The copy holds no DOM node and no Fiber, so
delaying it and retaining the element is not the same operation.

The element is then detached and unreachable from the document, and the record
still names the component that owned it, the component whose JSX put it there,
and the file and line where that was written.

## The identity crosses; the name does not

A page under test talks to services, and a service is the wrong shape to ask
about a suite. It outlives every subject in the run, it answers several of them
at once, and nothing inside it can evaluate a test — a time window is not an
execution.

What crosses instead is a **journey**: one opaque UUID per execution, minted by
the driver and set on the browser context before the first navigation, beside
the address this worker is listening on. The two travel as cookies —
`variance-authority-journey` and `variance-authority-return` — scoped to your
project's `baseURL`, so the browser attaches them to every same-origin request
it was already going to send and nothing in your application is touched to carry
them. A service built with probes reads both off the request's `Cookie` header,
runs the handler in an `AsyncLocalStorage` scope keyed by the journey, and when
that scope settles delivers what it entered as a JSON `POST` to
`<return>/journeys` over loopback `http`. Only the driver holds
`journey → subject`, so only the driver can join, and a report cannot claim an
execution by writing one down: the execution is in the address the report
arrived on, never in the body.

What that buys is not correlation but separation. Two specs running at once,
against one service process, inside one module, come back apart — the scope is
the execution, not a time window, so nothing is charged to whichever subject
happened to be open.

The sentence that falls out is one no single instrument can produce: _this spec
entered that branch of that service and the other spec never did_ — with the
service never told what a spec is.

## Declaring a head

A **head** is a process other than the page that reports its own crossings under
a name you give it. It is the one thing on this page you declare by hand, and
the declaration has three parts: the name in your Playwright config, the same
name in the service's environment, and one line in the service where requests
already pass.

```ts
// playwright.config.ts
export default {
  use: {
    baseURL: 'http://localhost:3000',
    varianceExecution: { heads: ['api'] },
  },
  webServer: {
    command: 'node ./server.js',
    url: 'http://localhost:3000',
    env: {
      VARIANCE_AUTHORITY_JOURNEYS: '1',
      VARIANCE_AUTHORITY_HEAD: 'api',
    },
  },
};
```

```ts
// server.js — wrap whatever you already have around a request
import { collectJourneys } from '@variance-authority/sense/journey';

const journeys = collectJourneys();

export function handled(cookie, run) {
  return journeys.enter(cookie, run);
}
```

`collectJourneys` takes its name from `VARIANCE_AUTHORITY_HEAD` and turns itself
on from `VARIANCE_AUTHORITY_JOURNEYS`, so that `env` block is the whole of the
configuration on the service side. Told neither, it installs nothing and `enter`
is the identity function — which is why the call above ships to production
rather than sitting behind a build flag. The name must match the `label` that
service's build gave `testSelectionProbes()`; an ordinal means something only
against the record that minted it.

`heads` is empty by default, and empty is the ordinary case. A Storybook preview
or a Vitest file is one process, the realm that executes is the realm that is
watched, no cookie is minted and none of the above runs. Declare a head when
your suite drives product source in a second process — otherwise a change to a
route handler runs every spec forever, no matter how well the browser half is
watched.

## An absence is never reported as a measurement

Every reading here separates _nothing was there_ from _nobody looked_, and does
it in the shape rather than in prose. Update initiators the renderer did not
expose are unavailable; an empty list is a completed reading. A node with no
reachable Fiber says which of the two reasons applies.

The case that costs something is the one worth reading. A declared head that
reports nothing all run — or one reporting a different probe recipe than the
driver records — retires the whole run's right to narrow anything:

```text
heads api reported nothing: a service that was not watched cannot be told from
one that executed nothing, so no subject in this run may justify an exclusion
```

Naming a head is a promise, and the setup behind it is extra setup: it can be
left out of one CI job, the service can fail to start, and a service built
without probes looks exactly like a service that executed nothing. An instrument
that reads silence as zero is confidently wrong in the direction that skips a
test. This one gives up the narrowing and prints why.

## What the narrowing is, and what it skips

The exclusion the message refuses is a **test file the next run does not
execute**. With a record in hand, `variance run --since origin/main` compares
the diff against what each test entered and hands the runner every test file it
would have run except the ones the record positively proves the change did not
reach: a file recorded as complete, whose journey contains none of the changed
regions. A test recorded partially, a region nobody read, a record older than
the lines it describes — none of those qualify, and each one widens the run
rather than narrowing it. [Running less of the suite](selecting.md) is the page
for that decision; [the path an execution took](journeys.md) is the page for the
record it reads.

That is what a half-watched run gives up. The crossings it collected are still
written and still queryable; what they lose is the right to justify a skip. A
spec skipped on the say-so of a service that was not watching is the one failure
this category cannot detect afterwards, so a run missing half its evidence
narrows nothing rather than narrowing on the half that arrived.

## A carried value joins; a derived one agrees until it stops

An answer spanning two instruments is worth what its key is worth, and two kinds
of key run through this system.

A **carried** value is produced once and propagated. The props digest is computed
by one function and read back by the diff and by the commit record; the JSX
coordinate is written by the transform; the journey id is minted by the driver
and handed back by the browser. Comparing one of these across a process boundary
compares a value to itself.

A **derived** value is computed independently at each end from something both
ends can see — a display name, a title, a wall clock. Those agree until they do
not, and nothing announces the day they stop.

So a cross-instrument answer joins on exact identities both producers emitted, or
it refuses and names the half that was missing. A name match is good enough when a
person looks something up by hand, and never between two instruments. It is also
why a joined view concludes _less_ than either half alone: a file that executed
with nothing addressing it is a replay candidate, and neither instrument
establishes that it is safe to mock.

## Where the retained data lands

Two artifacts, written to two places, read in two ways.

**The report** is what this run saw. `variance run` writes it to the path under
the `report` key in `variance.config.json` — `.variance/report.json` by
convention — and `variance report --format html > .variance/report.html` renders
it as a page. Keep the HTML beside the JSON: the image paths in it are relative
to the report. Attribution, `regions` and the rest arrive as fields on each
subject; [the lexicon](lexicon.md) is the field reference, and
[start with the CLI](start-cli.md) covers the config keys and the `accept` flow.

**The [execution record](execution-record.md)** is what every run so far has seen, and it is what
`--since` reads. It is a binary snapshot outside your work tree — under
`XDG_CACHE_HOME`, keyed by a digest of the checkout path — so `git status` never
sees it and it cannot reach a pull request. Nothing in a head or a page writes a
file; the driver merges into this one snapshot at teardown.
[The execution record](execution-record.md) gives the exact path, the reader to
import, and the cost of a lookup, a merge and a fold across shards.

## What the suite is for afterwards

None of this changes a verdict. The suite passes and fails on the assertions
somebody wrote. What changes is that the run stops being the only thing that
knew, and a question nobody thought to write down in advance has somewhere to be
asked.

Then: [see what a test addressed](eyes.md), [watch a run that has not
finished](vantage.md), [trace a flake to its cause](flakiness.md).
