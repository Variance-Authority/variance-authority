# Observability contracts: what a run keeps beyond pass or fail

A finished **run** (one execution of `variance run`) gives you one bit per
**subject** — one named UI state you asked for and can ask for again, whether
that is a story, a route, a fixture or a value — and that bit is pass or fail.
Read this page to decide which of the other things a run can keep are worth
keeping, and what each one is and is not evidence of.

The execution that produced that bit knew more. It knew which elements the test
addressed, which components rendered, which instance scheduled each render, and
which branch a service took while the page was waiting on it. Teardown is
normally the end of all of it. `Unable to find element` names a question without
naming the button, the component that owned it, the code that put it there, or
the update that removed it — and the process that knew all four has exited by the
time the line is printed.

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

- **What the run promises you.** A reading nobody took is missing from a
  report's field list rather than present and zero. A cross-instrument answer
  joins on identities both producers emitted, or it refuses and names the half
  that was missing.
- **What you promise the run.** Every declaration you make about your system —
  most of all a **head**, below — is checked rather than trusted.

When either side fails, the run marks every observation incomplete, writes what
it saw anyway, and refuses to narrow the next run: `variance run --since` then
runs the whole suite and prints the reason. Nothing here changes a baseline or an
exit code — your suite still passes and fails on the assertions you wrote, with
the same queries and the same expectations.

## Do you have to turn any of this on

Some of it is a flag, some of it is a change to your application build, and one
part is work in a service you own.

| What you get | What it costs you |
| --- | --- |
| Attribution on captured subjects — the component that owned a node, the JSX coordinate that wrote it | Nothing for React: the name is on the fiber. Every other framework needs the build step [composition](composition.md) describes. |
| Attention evidence — which elements a test addressed — in a unit or Playwright suite | Install [Eyes](eyes.md) and call `watch` once from your setup file. |
| A live view of a run that has not finished | One environment variable, [`VARIANCE_AUTHORITY_VANTAGE`](vantage.md). Under Playwright there is nothing to install. |
| **Journeys** — which regions of source each subject covered, and the report's `regions` field | A flag **and** a build change. Both, or you get neither. |
| A service's own crossings folded into the same record | The build change again, in that service, plus an environment block and one line where requests already pass. |

### Attention evidence: install Eyes, call `watch` once

```bash
npm install --save-dev @variance-authority/eyes
```

`watch(screen: object, log?: EyesLog): RtlWatch` instruments one React Testing
Library `screen` object in place, so every later import of that same object is
observed. Call it once, from Jest `setupFilesAfterEnv`, Vitest `setupFiles`, or
a test file:

```ts
// vitest.setup.ts
import { screen } from '@testing-library/react';
import { watch } from '@variance-authority/eyes/rtl';

export const attention = watch(screen);
```

`attention.log.seen` reads the current journal, `attention.log.drain()` takes its
entries, and `attention.close()` restores every method once no watcher remains.
`within()` and the queries returned by `render()` are different bound objects and
stay outside this entrypoint. To scope a journal to one runner-identified test
instead of the whole file, `watchTest(screen, identity)` from the same module
pairs the log, the identity and the drain in one object.

### A live view: name the address in the environment

Start a watcher, which prints the address it chose:

```bash
variance watch
```

Then run the suite with that address in `VARIANCE_AUTHORITY_VANTAGE`. Under
Playwright the `varianceVantage` fixture reads it for you and
`@variance-authority/playwright-test` already depends on the package, so there is
nothing further to install. Any other runner opens the same end by hand:

```bash
npm install --save-dev @variance-authority/vantage
```

```ts
import { openVantage } from '@variance-authority/vantage';

// openVantage(address?: string): Vantage | undefined
const vantage = openVantage();
vantage?.opened('t-1', { title: 'cart adds an item', file: 'cart.spec.ts', worker: 0 });
```

`openVantage` defaults its `address` argument to `process.env.VARIANCE_AUTHORITY_VANTAGE`
and returns `undefined` when that is unset or names nothing that answers, so an
unwatched run pays one environment read per worker. [Watch a run that has not
finished](vantage.md) is the page for what you can then ask it.

### Journeys: the flag and the build change

The flag is `tests: true` in the Storybook collector's options, or
`use: { varianceExecution: true }` in `playwright.config.ts`. The build change is
`testSelectionProbes()` in the Vite config that bundles your product source:

```bash
npm install --save-dev @variance-authority/sense
```

```ts
// .storybook/main.js — or the Vite config of the app your suite drives
import { testSelectionProbes } from '@variance-authority/sense/journal';

export default {
  viteFinal: (config) => ({
    ...config,
    plugins: [...config.plugins, testSelectionProbes({ label: 'storybook' })],
  }),
};
```

`testSelectionProbes(options?: TestSelectionProbeOptions)` takes four optional
fields: `root` (repository root, defaults to the current directory), `include`
(which transformed modules count as product source), `label` (defaults to
`build`, and separates two bundlers over one repository), and `cacheRoot` (where
the module records go, defaulting to the user cache). Give a Storybook preview
and the application a Playwright suite drives different labels — one label for
both answers a block ordinal with whichever build wrote its inventory last.

The flag alone records nothing: with `tests` on and no probes in the preview, the
run prints one line to stderr saying so and continues, and the next `--since`
runs everything. That pair is one switch with two consequences. The same journal
read drives the **journey** record *and* the `regions` field on every subject in
the report, so a build without probes costs you two sections rather than one.
[The lexicon](lexicon.md) lists `regions` among the fields that are absent rather
than empty when the reading was never taken.

## What keeping it costs

The instrumented build writes more than an uninstrumented one, and the driver
does one extra thing at teardown.

- **Extra artifacts.** Each instrumenting build keeps a store of module records
  under its own `<label>`, beside a module names table in `names.bin`. A run in
  progress keeps a `.run-<pid>-<uuid>` directory next to them until the reporter
  folds the journals into the snapshot and removes it. All of this sits in the
  cache directory rather than your work tree.
- **Extra wall clock, at teardown.** Nothing in a head or a page writes a file
  during the run; the driver merges every journal into one snapshot after the
  suite finishes. [The execution record](execution-record.md) gives the cost of a
  lookup, a merge and a fold across shards.
- **Unwatched instruments.** `openVantage()` with nothing listening is one
  environment read per worker.

[What a source scan costs](performance.md) prices that stage against a checkout
you can size yours next to.

## The record, rather than the breakpoint

Open dev tools on a live page and every one of these facts is available: the
component that produced a node, the update that scheduled a render, the branch a
module took. Three conditions have to be true for that — the page is running,
execution is stopped, and a person is watching. In CI none of the three is true,
and for anything reading a result an hour later none of them ever will. So the
record is taken while the page is alive and kept once it is gone.

## Attribution is copied before it can be destroyed

React removes its Fiber pointer from a DOM node when the node unmounts. A click
handler that removes the element it fired on has destroyed that element's
[attribution](attribution.md) before the test's next statement runs — between two
adjacent lines of the test file, which is why a retry, a screenshot, or a trace
replayed afterwards all arrive too late for it.

[Eyes](eyes.md) — the package `@variance-authority/eyes`, unrelated to the
commercial product of the same name — listens on `document` in the capture
phase, ahead of React's delegated handler on the root container, and copies the
owner chain, the props digest at each boundary, the authoring component and the
JSX coordinate into a plain value in that same synchronous turn. The copy
points at no DOM node and no Fiber, so delaying it and retaining the element is
not the same operation.

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
that scope settles delivers what it covered as a JSON `POST` to
`<return>/journeys` over loopback `http`. Only the driver knows
`journey → subject`, so only the driver can join, and a report cannot claim an
execution by writing one down: the execution is in the address the report
arrived on, never in the body.

Two specs running at once, against one service process, inside one module, come
back apart — the scope is the execution rather than a time window, so nothing is
charged to whichever subject happened to be open. You can then read _this spec
covered that branch of that service and the other spec never did_, with the
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

Every reading here separates _nothing was there_ from _nobody looked_, in the
shape of the data rather than in prose. Update initiators the renderer did not
expose are unavailable; an empty list is a completed reading. A node with no
reachable Fiber says which of the two reasons applies.

A declared head that reports nothing all run — or one reporting a different probe
recipe than the driver records — retires the whole run's right to narrow
anything:

```text
heads api reported nothing: a service that was not watched cannot be told from
one that executed nothing, so no subject in this run may justify an exclusion
```

Naming a head is a promise, and the setup behind it is extra setup: it can be
left out of one CI job, the service can fail to start, and a service built
without probes looks exactly like a service that executed nothing. Reading that
silence as zero would skip a test, so the run gives up the narrowing and prints
why.

## What the narrowing is, and what it skips

The exclusion the message refuses is a **test file the next run does not
execute**. With a record in hand, `variance run --since origin/main` compares
the diff against what each test covered and hands the runner every test file it
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

## A carried value joins; a derived one drifts

An answer spanning two instruments is worth what its key is worth, and two kinds
of key run through this system.

A **carried** value is produced once and propagated. The props digest is computed
by one function and read back by the diff and by the commit record; the JSX
coordinate is written by the transform; the journey id is minted by the driver
and handed back by the browser. Comparing one of these across a process boundary
compares a value to itself.

A **derived** value is computed independently at each end from something both
ends can see — a display name, a title, a wall clock. Two ends computing the same
key agree until one of them changes, and nothing reports the change.

So a cross-instrument answer joins on exact identities both producers emitted, or
it refuses and names the half that was missing. A name match is good enough when
a person looks something up by hand, and never between two instruments. It is
also why a joined view concludes _less_ than either half alone: a file that
executed with nothing addressing it is a replay candidate, and neither instrument
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

**The [execution record](execution-record.md)** is what every run so far has
seen, and it is what `--since` reads. It is a binary snapshot outside your work
tree:

```
<cache>/variance-authority/test-selection/<repository-digest>/coverage.bin
```

`<cache>` is `XDG_CACHE_HOME`, or `~/.cache` when that is unset, and
`<repository-digest>` is a digest of the checkout's absolute path, so two
checkouts never write one another's bytes. `git status` never sees it and it
can never land in a pull request. Nothing in a head or a page writes a file; the
driver merges into this one snapshot at teardown. [The execution
record](execution-record.md) gives the reader to import and the cost of a
lookup, a merge and a fold across shards.

### Passing the record between CI runs

A fresh runner has no record, so the first `--since` there runs everything. Two
ways to give the next job something to read:

- **Cache the directory.** Cache and restore the directory the snapshot sits in,
  and restore it to the same absolute path it was written from — the digest in
  the path is the checkout's absolute path, so a record restored under a
  different working directory is read as absent. Key it by that path rather than
  by the branch or the commit; the contents are content-addressed, so a record
  restored from another branch costs a slower run and cannot produce a wrong
  answer. [The source index](source-index.md) states the same four rules for the
  other half of the cache, including the endianness limit on moving either file
  between machines.
- **Name the path yourself and upload it.** Pass `coverageFile` to the Vitest,
  Jest or Playwright integration to put the snapshot at a path you choose,
  typically inside the repository so CI can upload it as an artifact, and ignore
  that path in git. Turning on `cases` writes a second file at
  `<coverageFile>.cases.bin`, under the same rule.

A missing, foreign or corrupt file is read as an absent record rather than an
empty one, so a job that restored nothing runs the whole suite. Deleting the
directory is the whole recovery procedure, for a stale record and a corrupt one
alike, and costs one full run.

## What the suite is for afterwards

None of this changes a verdict. The suite passes and fails on the assertions
somebody wrote. What it adds is a place to ask a question nobody thought to write
down in advance.

Then: [see what a test addressed](eyes.md), [watch a run that has not
finished](vantage.md), [trace a flake to its cause](flakiness.md).
