<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/mcp

> Let an agent ask questions about a test run that has already finished.

Part of [Variance Authority](https://variance-authority.dev).

Reach for this package only to hand an already-finished run, or an execution
index, to an agent that speaks MCP.

It is an MCP server over stdio. It reads a file something else produced — the
JSON report a run wrote, or a record of which tests entered which source — and
answers questions about it in plain text. It never runs tests, re-renders
anything, or changes a baseline, and it adds nothing to the evidence it was
given.

Skip it if there is no MCP client in the loop. Running the suite and reading its
output yourself is [`@variance-authority/cli`](https://variance-authority.dev/reference/packages/cli)
(`variance run`, `variance accept`), with no server or protocol involved. That
same CLI also offers the report questions below as shell commands — `variance ask
<question>` — so nothing here is reachable only through a client. What a
connection adds is the other evidence an agent can be handed: an execution index,
a suite still running, a record of what each test touched.

## Produce a report first

Every report tool on this page answers from one file, `.variance/report.json` by
default, and nothing in this package produces it. It comes from the CLI:

```bash
npm install --save-dev @variance-authority/cli
npx playwright install chromium
# write variance.config.json, then:
variance run --config variance.config.json
```

`variance run` writes the report at the path the config's `report` key names,
`.variance/report.json` unless you change it. Setting up the config and the
collector that mounts each UI state is
[run visual review from the command line](https://variance-authority.dev/docs/start-cli).

The report holds one record per **subject** — one named UI state you asked for
and can ask for again, such as `checkout/empty`. Storybook stories become
subjects with a `story:` prefix, so `card--dark` is `story:card--dark`.

## Serve it to a client

If you installed the CLI above, no further install is needed — `variance serve`
is that server, reading the report your config names:

```bash
variance serve --config variance.config.json   # MCP over stdio
```

Install this package when you want the server without the CLI, or when the
client should launch a binary that takes the report path as its only argument:

```bash
npm install --save-dev @variance-authority/mcp
```

```bash
variance-authority-mcp .variance/report.json   # a run that finished
variance-authority-mcp --watch                 # a run that has not
```

Either binary goes in the client's server list:

```jsonc
// claude_desktop_config.json, or any MCP client
{
  "mcpServers": {
    "variance": { "command": "variance-authority-mcp", "args": [".variance/report.json"] }
  }
}
```

The server re-reads the report on every request, so an agent that fixes
something, re-runs, and asks again is answered from the new report rather than
from the one loaded at startup.

## What an answer looks like

Every tool returns text, not JSON. `variance_changes` on a run where a brand
colour moved in `Button` and a radius token moved in `Card`, across 35 stories:

```
35 subject(s) changed, and they are 2 distinct change(s) — 2 of which can be decided in one action

Button
  src/Button.tsx
  reaches 32 subject(s); it is the whole change in 31
  in the other 1, something else also moved, so accepting this shape there would promote a difference nobody reviewed
  3840 pixel(s): story:button-0, story:button-1, story:button-2, story:button-3, and 28 more
  variance accept --shape v1:11111111111111111111111111111111

Card
  src/Card.tsx
  reaches 4 subject(s); it is the whole change in 3
  in the other 1, something else also moved, so accepting this shape there would promote a difference nobody reviewed
  240 pixel(s): story:card-0, story:card-1, story:card-2, story:both
  variance accept --shape v1:22222222222222222222222222222222
```

## Visual report tool contract

Twelve tools, all answering from the report file and **never re-running
anything**. The run may have happened on a pinned machine in CI an hour ago; the
questions are asked wherever the agent is. One compares invocations; the other
eleven inspect the current report.

A **component** is a named unit inside a rendering, such as `Button`; the same
component can appear inside several subjects, which is what
`variance_composition` and `variance_trace_component` below compare.

The tools are also importable as plain functions, with no protocol and no
server, from `@variance-authority/mcp/tools`:

```ts
import { readFile } from 'node:fs/promises';
import { toolByName } from '@variance-authority/mcp/tools';

const report = JSON.parse(await readFile('.variance/report.json', 'utf8'));

console.log(toolByName('variance_summary')?.run(report, {}));
console.log(toolByName('variance_changes')?.run(report, {}));
console.log(toolByName('variance_findings')?.run(report, {}));
console.log(toolByName('variance_locate')?.run(report, { query: 'card footer' }));
console.log(toolByName('variance_composition')?.run(report, {}));
console.log(toolByName('variance_composition')?.run(report, { subject: 'story:card--populated' }));
console.log(toolByName('variance_describe')?.run(report, { subject: 'story:card--populated' }));
console.log(toolByName('variance_variations')?.run(report, { subject: 'story:card--dark' }));
console.log(toolByName('variance_trace_component')?.run(report, { component: 'Button' }));
console.log(toolByName('variance_explain_verdict')?.run(report, { subject: 'story:card--populated' }));
console.log(toolByName('variance_changelog')?.run(report, { shape: 'v1:9a3f1c2e04' }));
console.log(
  toolByName('variance_adjudicate')?.run(report, {
    claims: [{ root: 'component:Button', reason: 'new brand accent', maxSubjects: 3 }],
  }),
);
```

`variance_diff` is the twelfth, and the only one that needs a second value — the
state it is comparing against, which the server holds for you between calls.
Called directly, you supply it:

```ts
const previous = JSON.parse(await readFile('.variance/report.previous.json', 'utf8'));

console.log(toolByName('variance_diff')?.run(report, {}, { previous }));
```

The subject ids, the shape digest and the previous-report path above are
placeholders: use ids from your own run, and a digest `variance_changes` printed.


| tool | answers | ask it when |
|---|---|---|
| `variance_summary` | how the run came out across every subject, including the ones nobody observed | starting from nothing: *did anything change, and was anything missed?* |
| `variance_diff` | how the current supplied state differs from the previous successful MCP tool invocation | after rerunning or replacing the supplied evidence |
| `variance_changes` | the distinct changes behind the changed subjects, most decidable first, each with the command that settles it | immediately after the summary, before touching any individual subject |
| `variance_adjudicate` | this run against **what you said you were doing**: declared and delivered, changed and undeclared, and declared and never happened | you edited something and are reading your own run — declare before you read the diff |
| `variance_composition` | the run's subjects compared to **each other**: the component graph, the renderings two examples share, and why each changed component changed — including *nothing here explains it*; with `subject`, what one subject is made of and which of its renderings other subjects share | a change has no obvious author, or you are about to call something flaky |
| `variance_locate` | the subjects a `query` describes, matched over every name the run wrote down — ids, examples, accessible names, text, components, creators, files, roles, tokens, and the source-code regions its tests entered — each hit printing the field it matched | you can describe the subject and do not know its id |
| `variance_variations` | the measured difference between a subject and the subject it declares as its parent, such as a feature flag, theme, or viewport | reviewing what a variant changes rather than whether it regressed |
| `variance_changelog` | what accepting this run would write into the baseline record: the lines the commit will carry, and the subjects that would be refused | before proposing an `accept` command, because the record is written once and outlives the run |
| `variance_describe` | what changed inside one subject — the changed pixel regions, the component each belongs to, the files | the summary named a subject and you need the detail |
| `variance_findings` | accessibility defects in the renders themselves, grouped by rule, with no baseline involved | fixing a component, whether or not it changed |
| `variance_trace_component` | every subject one component appears in, with pixels and cause-or-displaced | sizing the blast radius of a design-system or token edit |
| `variance_explain_verdict` | why a subject was **not compared** — `incomparable`, `new`, or never observed | before attempting a fix, because none of those is a code problem |

`variance_changes` is the one that decides how many of the others get called. A
design-token edit reaching forty stories is one decision presented as forty, and
an agent that walks them one at a time spends forty calls learning what one call
says. It is also the only tool that hands back a *command* — the shape digest
cannot be derived from anything else in the report, and it names which subjects
the command will refuse, so the agent proposes something that works rather than
something that gets rejected.

`variance_adjudicate` is the only tool that takes evidence *in*, and the only
one that can report an **absence**. Everything else answers about the run;
this answers about the agent. `variance_changes` can say that `Button` changed in
twelve subjects. It cannot say that `Card` — which the agent believes it just
edited — did not change at all, because a diff has no opinion about what was
supposed to happen. That third case is where a wrong file, a dead branch, an
overridden rule or a stale build surfaces, and no screenshot comparison reaches
it.

The declaration has to come first: the tool takes claims as an argument rather
than deriving them, so an agent must state what it expected before reading what
happened. A claim that reaches more subjects than it declared comes back
`overreached`.

A claim carrying a field this resolution cannot check is named rather than
dropped. A **band** is a category of visual difference, such as `content` or
`geometry`; an agent told `delivered` about a band nothing looked at has been
told something the run never established, so the answer ends `Not checked here:
bands`.

`variance_changelog` previews what accepting this run would write into the
baseline record, before the write happens — otherwise a baseline update is only
explained in the commit that carries it, which does not exist until `accept`
runs. The preview renders the record's own lines through the same function that
writes the commit, over the subject set the same rules select, so the preview
and the eventual commit cannot disagree. It stops short of the commit trailers:
those are written only once a promotion has actually happened.

`variance_composition` is the only one that reads the other axis. Everything
else compares a subject to its baseline — two revisions, one thing. This
compares the run's subjects to each other, at one commit, because **a
visual-regression example is a component built from components**: the example
*is* a component at a boundary, and the same component appears again, with the
same or different props, inside larger examples. Once those boundaries are
addressable the run can say which of its examples are watching literally the
same bytes, which of them disagree at one commit, and — for anything that
changed — whether an edited file, a changed token or an edited *caller* accounts
for it.

This is also where an unexplained difference gets a **control group**: the
subjects where that same component, with the same props, held — did not change —
the stable states to compare against. Given one, an unexplained difference is
`flake` if the subject also failed to read the same way twice, or `suspect` — a
shortlist, not a verdict — if nobody has read it twice yet.

`variance_summary` labels a subject by what it *is*, which is not always its
verdict. Three subjects can all be `changed` — the pixels did change — and need
three different people:

| label | what happened | what to do |
|---|---|---|
| `unstable` | read twice, seconds apart, nothing changed in between, and the two readings disagreed | fix what moves between readings; the named component and band say where. Do not review the pixel regions — which ones appear was decided by a race |
| `order-dependent` | the difference is gone when the subject is collected with nothing else in the world | do not change the component; bisect run order to find the subject that writes the state this one reads |
| `changed` | it survived both | review it |

A fourth state is deliberately *not* on that table. A **sensitivity level** is a
per-subject declaration of which bands it asserts on — a route declared `layout`
has said, in its config, that it does not assert on what the page is painted
with, so a clock inside it is a fact about the page rather than a defect. A
subject whose two readings differed entirely in bands outside its declared level
is listed under **not asserted on** and carries no instruction. It is still named
and counted, with the rule that absorbed it — the same reason a subject whose
pixels were excluded by an ignore rule is reported as `ignored` rather than
folded into `unchanged`: an exclusion nobody can see again is one nobody is
really watching.

`accept` refuses `unstable` and `order-dependent` subjects; only `changed` can be
promoted. Instability is checked first: the clean-vs-shared comparison behind
`order-dependent` only means something when a subject's two readings would
otherwise agree.

`variance_findings` is the one that is not about a change. A control that never
had an accessible name compares equal to itself on every run, so a comparison can
never report it — and an agent asked to fix a component wants it anyway. Its
findings do not affect the verdict, and an empty answer distinguishes *inspected
and clean* from *nobody looked* — the same distinction `variance_summary` keeps
when it accounts for the subjects nobody observed.

## Coverage boundary

An agent told **"no changes"** concludes the product is fine. If what actually
happened is that eleven subjects failed to render, that sentence is a lie the
agent will act on — and unlike a human reading a dashboard, it has nothing else
to check against.

So the summary accounts for every subject including the ones nobody observed, and
a run with unobserved subjects never reads as clean. `notObserved` is the list of
subjects the run planned and has no result for; it distinguishes `excluded` from
`failed`, and a malformed entry is refused rather than defaulted: guessing
`excluded` turns a coverage hole into a decision somebody made, and guessing
`failed` turns every deliberate exclusion into a permanently red build.

## The narrowing coordinate

`variance_summary` prints, in its header, where the recorded execution index
stands and how many files the working tree differs from it by — followed by the
`variance run --since <commit>` that would observe only what those files reach.

It is in the header rather than in a tool of its own because an option an agent
is never told about is an option it does not have. Nothing about the line
proposes that a run should have skipped anything; narrowing stays the operator's
decision, and the header carries the coordinate the decision needs. It is omitted
when there is nothing to offer: no index on disk, an index with no position, or
a working tree that has not changed since.

## Diff against the previous call

The word **subject** carries two grains here, and both are in the source. Inside
a report it is one UI state, as above. In the server API it is the whole value
being served — a `RunReport` for the visual tools, an `ExecutionIndex` for the
source-test tool, a `VantageState` for a suite that is still running, or an
`ObservabilitySubject` carrying several of those at once.

`variance_diff` compares the currently served value with the value from the
previous successful tool call. The first call records the current state and says
there is nothing to compare. Each successful call then replaces that one value.

The value lives only in the MCP process. It is not written to disk, does not
touch or replace a baseline, and disappears when the process exits. Initialization,
tool discovery, invalid calls, and failed calls do not replace it.

`diffState(before, after)` exposes the same JSON-compatible state comparison
without MCP framing.

## Answer from the source tree

A question can say where to start — `variance_locate {query, from}` takes a path
and answers only from the files reachable from it, along the imports. `to` is
the same walk against them, answering from the files that reach the path
instead: `from` the screen to find what it shows, `to` the component to find
what shows it. A path is a fact about a repository, and a report is a file that travels, so the repository has to be
named when the server is started. `serveReportFile(path, options)` takes it:

| option | what it decides |
|---|---|
| `root` | the repository the run was made in. Without it, a question carrying a start point is refused rather than answered from the paths the run happened to record |
| `index` | where the scan keeps what it has already parsed, so a second question that names a path costs a map lookup per unchanged file instead of a parse |

`readTree(options)` is the same walk on its own, for a host that would rather
read the tree itself and hand it to a call:

| option | what it decides |
|---|---|
| `root` | the repository. Every coordinate comes back relative to it |
| `dirs` | where to start walking, relative to the root. The whole repository by default, because a start point may name any path in it and a narrower walk answers *not found* about a file that is plainly there |
| `index` | the persistent scan index, as above |

The walk happens once per session and only when something asks for it: most
questions do not name a path, and a repository is not a thing to read before
anybody wanted it.

## Watch a suite that has not finished

Every tool above answers about a run that is over. `--watch` answers about one
that is not.

```bash
variance-authority-mcp --watch
```

It prints, on stderr, the one line the suite has to be started with:

```
variance-authority is watching. Start the suite with:
  VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321
```

That variable goes wherever `VARIANCE_AUTHORITY_EVENTS` goes. The suite needs
`varianceFixtures` from `@variance-authority/playwright-test` and nothing else,
**and none of it is about visual regression** — a test that takes no screenshot
reports exactly what one that does reports.

The same line is handed to the client at the handshake, as the server's
`instructions`, because stderr goes to a log the model never reads. An agent
that is told the address only after it has already started the suite has been
told it one run too late.

| tool | answers | ask it when |
|---|---|---|
| `variance_self` | where this watcher is listening, what it is holding, and exactly what to start a suite with | first, and again whenever an answer is emptier than expected |
| `variance_run_signals` | every test that has reported, in the order the run opened them, its state, and how much each has announced | you want to know where the suite has got to, or which test is the one still going |
| `variance_test_signals` | everything one test has announced, in order, with the realm that said each, plus work that started and never ended | a test is hanging, or failed, and the assertion that did not settle is the part you already know |
| `variance_waiting` | which tests have stopped at an `await variance.observe()` call, where each stopped, and what it sent from there | before looking at anything, and whenever you want to know whether a run is holding something open for you |
| `variance_continue` | nothing; it lets a stopped test go on | you have finished looking at what one was holding still |

`variance_run_signals` takes `state`, `file` and `limit`, and marks a running
test with `▸` and a stopped one as `waiting`. `variance_test_signals` takes `test` — an id from the listing, a
title, or enough of one to be unambiguous; where it is not unambiguous, the
answer is the candidates and their ids. `variance_self` takes nothing.

`variance_self` is the one that separates the two reasons an answer is empty:
nothing has run yet, or something ran and reported somewhere else. A connection
is told the address at the handshake and can see itself connected, so it needs
this least — a reader that runs one command and exits has no handshake to look
at, and asks it most.

`variance_waiting` and `variance_continue` are the pair that make a run
something to *interrupt* rather than only something to read. Where a test author
wrote `await variance.observe()`, the test stops there and holds everything it
had — the page up, the network as it was — until you say go on; the runner's
clock is stopped while it stands still. `variance_waiting` says which tests are
stopped and where, and prints whatever they sent from those points;
`variance_continue` takes one id, or nothing at all to release everything.

Neither is offered by `variance ask`. A shell command holds no run, so there is
nothing in it to release, and one that reported success while nothing moved
would be worse than a missing one.

`variance_test_signals` is the one a timeout cannot give. A runner reports what a test
*wanted*; this reports what its execution actually **heard**, and from whom.
Nothing at all is a wiring fact — no listener installed, or code that does not
announce yet. A page that spoke while a service did not is a request that never
arrived or never came back. Three announcements and then silence, with one
`vaStart` still open, names the call that is hanging.

Nothing is written down and nothing is added to the run's evidence: a report file
records what a run **decided**, and this records what it **is doing**, which
stops being a fact the moment this process exits. What it holds is bounded, and
it says so when it dropped something, because a reader who cannot tell *nothing
was announced* from *the beginning was forgotten* draws the first conclusion.

`variance_diff` is served here too, so *what changed since I last asked* works
against a suite in flight the same way it works against a report.

The same three questions, and `variance_diff` with them, are on the command line
without a client: `variance watch` holds the run and `variance ask <question>
--at <address>` reads it. Same functions, same text, no client configuration to
edit — see [ask a run from the command line](https://variance-authority.dev/docs/agent-cli).

## Give an agent the tests for source

`variance_source_tests` answers the question a coding agent needs before and
after an edit: which named tests reached this source, and how directly? A line
or function query returns tests ordered by minimum observed call-stack depth. A
file query returns every indexed line as compact ranges, including ranges no
test reached.

An `ExecutionIndex` is what [`@variance-authority/sense`](https://variance-authority.dev/reference/packages/sense)
writes: a record, per test, of which regions of which source files that test
entered while it ran. An integration that owns the current one serves it directly; the
supplier is called for every request so a rerun is visible without restarting
the agent's MCP connection:

```ts
import { serve } from '@variance-authority/mcp';
import { SOURCE_TESTS } from '@variance-authority/mcp/protocol';
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';

export function serveSourceTests(current: () => ExecutionIndex | Promise<ExecutionIndex>) {
  return serve({
    input: process.stdin,
    output: process.stdout,
    served: SOURCE_TESTS,
    subject: current,
  });
}
```

That is an excerpt: it exports the server but never calls it. Call
`serveSourceTests(() => yourIndex)` from a module the client launches, and keep
the process alive — the returned function detaches the server from its streams.

The tool takes `file` and optionally one of `line` or `function`. With neither,
it answers the whole file. It distinguishes an indexed range reached by no test
from a line absent from the execution index. The index is supplied by the test
collector or editor integration; MCP does not manufacture coverage or control
the test runner.

## Serve several kinds of evidence at once

A run report is one of six things this package can answer from. The others are
produced by sibling packages, and an integration that holds more than one can
serve them over a single connection as an `ObservabilitySubject`, whose
`OBSERVABILITY` tool set this package exports. Each field is optional, because
each producer has its own lifecycle and retention rules:

```ts
import { serve } from '@variance-authority/mcp';
import { OBSERVABILITY } from '@variance-authority/mcp/protocol';
import type { ObservabilitySubject } from '@variance-authority/mcp';

export function serveObservability(current: () => ObservabilitySubject) {
  return serve({
    input: process.stdin,
    output: process.stdout,
    served: OBSERVABILITY,
    subject: current,
  });
}
```

An excerpt for the same reason: something has to call `serveObservability` with
a supplier of your subject, from the entry module the client launches.

The handshake tells the client to call `variance_observability` first. Its
answer distinguishes a missing domain from a supplied domain that measured zero
members. Native tools remain available on the same connection:

| tool | evidence | answers |
|---|---|---|
| `variance_test_attention` | an **Eyes archive** — what [`@variance-authority/eyes`](https://variance-authority.dev/reference/packages/eyes) recorded about which DOM elements each test addressed, and which React component rendered each | one test's selectors, Locator consumption, DOM events, synchronous Fiber attribution, and authored AAA markers |
| `variance_presentations` | presentation reports | full presentation graphs, telemetry, semantic evidence, measured structures, and findings |
| `variance_source_tests` | a Sense execution index, as above | which named tests entered source and their minimum observed distance |
| `variance_run_signals`, `variance_test_signals` | **Vantage state** — what [`@variance-authority/vantage`](https://variance-authority.dev/reference/packages/vantage) is holding for a suite that has not finished | what an in-flight suite and one test have announced |
| `variance_waiting`, `variance_continue` | Vantage state | which tests have stopped for you to look at them, and letting one go on |
| visual report tools | run report | visual decisions, presentation signals, composition, variation, history, and review evidence |
| `variance_scenarios` | scenario manifests | the witnessed Arrange state and observed or unobserved Act outcomes |
| `variance_distill` | an Eyes archive and/or a Sense execution index | one test's addressed AAA surface, React update initiators, and source reduction opportunities |

`variance_distill` is the deliberate cross-domain answer. It maps the
DOM owners and source locations a test addressed in each authored phase, then
places React update initiators inside or outside those exact structural component
paths and contrasts both with files that the same exact test id entered.
`PerformedWork` says a render body ran; it is not substituted for an updater.
An entered file with no addressed target is a distillation opportunity, not proof that
the branch is unrelated or safe to mock. The tool does not join by title or file
when stable producer identities disagree. `ExecutionIndex` retains whole-test
crossings, not AAA intervals, so runtime files remain test-scoped rather than
phase-scoped.

The CLI exposes the same analyzer and formatter over portable files as
`variance distill`. The agent verification workflow is described in
[distill a test](https://variance-authority.dev/docs/distill).

The individual served sets remain available as `REPORTS`, `PRESENTATIONS`,
`SOURCE_TESTS`, `VANTAGE`, `EYES`, and `SCENARIOS`. Use one when the integration
owns only that domain. React Testing Library and Playwright remain optional peer dependencies
of `@variance-authority/eyes`; installing MCP does not add either runner.

### When a domain is unavailable

MCP does not manufacture a missing observation. `variance_observability` names
the producer and route for every unavailable domain:

| unavailable domain | supply it from | integration contract |
|---|---|---|
| visual report and durable presentation signals | `variance run` | configure its `report` path and supply the resulting `RunReport`; see [run an existing collector](https://variance-authority.dev/docs/start-cli) |
| presentation readings | `@variance-authority/presentation/playwright` | call `sensePresentation` on the live subject and supply the returned full graph; see [presentation](https://variance-authority.dev/docs/presentation) |
| runtime journey | a Vitest run wrapped with `cases: true`, or any other per-test collector | supply an `ExecutionIndex` with stable per-test ids; see [record which case entered a region](https://variance-authority.dev/reference/packages/sense#record-which-case-entered-a-region) |
| live journey and events | `@variance-authority/playwright-test` plus a watcher | compose `varianceFixtures`, start the watcher first, then pass its exact `VARIANCE_AUTHORITY_VANTAGE` assignment to the suite; see [inspect a live run](https://variance-authority.dev/docs/agent-live-run) |
| Eyes attention | `@variance-authority/eyes` | compose the host adapter, author AAA phase markers, retain per-test journals with their completion state under stable runner ids, and install React observation before `react-dom`; see the [Eyes integration reference](https://variance-authority.dev/reference/packages/eyes) |
| scenario AAA | `@variance-authority/scenario` | record host-produced semantic snapshots and authored Acts, then use the archive entrypoint when the evidence must survive the process; see the [scenario reference](https://variance-authority.dev/reference/packages/scenario) |

The full mechanics stay with each producer. The MCP answer carries the minimum
route and the constraint that would otherwise produce plausible but invalid
evidence. The dedicated `REPORTS`, `PRESENTATIONS`, `SOURCE_TESTS`, `EYES`, and
`SCENARIOS` served sets carry the same route in their initialization handshake,
so an integration does not need the combined surface to receive it.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | stdio | `serve`, `serveReportFile` and `serveVantage`, and the subject locator |
| `./tools` | nothing | observability answers as pure functions over their native evidence |
| `./protocol` | nothing | MCP framing, as a pure function from a request to a response |

Two of the three are pure, and that is deliberate. The question that
matters — *does this actually help an agent fix it?* — has to stay cheap to ask,
and it stops being asked the moment answering it requires speaking a protocol
over a pipe.

What a producer *wrote* is not here either. Reports, execution indexes, live
state, Eyes archives, and scenario manifests belong to their producing
packages. MCP reads those contracts; it owns none.
## Serve a custom subject

`serveReportFile(path)` is the whole executable, and `serve(options)` is what it
composes when the report does not come from a file:

| option | what it decides |
|---|---|
| `input` | the `Readable` requests arrive on |
| `output` | the `Writable` responses leave on |
| `served` | the `Served<Subject>` name and tools for the subject; use `REPORTS` for a `RunReport` or supply a set for another serializable subject |
| `subject` | supplies the current subject. A function rather than a value, so a long-lived server picks up a re-run without a restart — an agent that fixes something and asks again should be answered from the new report, not from the one loaded at boot. It may be async, and the request waits for it: a supplier that started a refresh and answered from the previous value would make *this* request the stale one, and this request is the agent that just re-ran |

A `Served` is a name, a version and the tools. It may also carry
`instructions`, a function of the subject whose answer the client puts in front
of the model before it has called anything — for a set of tools whose subject
has to be *arranged* first, and which therefore reads as broken to an agent that
finds it empty. `REPORTS` has none: a report on disk is already there.

Both return a function that detaches the server from its streams.
`serveVantage()` is the third: it opens the listener, serves the watch tools over
the same streams, and returns the `address` to start a run with alongside the
call that stops both. Its subject is a snapshot taken per request, which is why a
subject that keeps changing fits a surface built for one that does not.

## Stability

**The tool names, their argument shapes and the wording of their answers carry no
compatibility guarantee.** They are answers chosen to be useful to an agent
rather than a published interface, and an answer that turns out to be the wrong
one to give will change without a deprecation. If you need them to hold still,
import `@variance-authority/mcp/tools` behind an adapter of your own and pin the
version.

---

**[@variance-authority/mcp](https://variance-authority.dev/reference/packages/mcp)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
