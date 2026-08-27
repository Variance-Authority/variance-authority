<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/mcp

> Expose a completed visual run and its source-to-test selection to an MCP client.

**Variance Authority** is a visual regression toolkit for web interfaces: it
compares a rendered subject against an approved baseline and reports which
component caused each change. This package is one piece of it.

Use this package when an MCP client needs to inspect a completed visual run or
ask which named tests exercise source. The server reads supplied evidence and
returns text; it never runs tests, rerenders a subject, changes a baseline, or
infers evidence that is not there.

**Requires:** an MCP client that speaks over stdio, plus a run report for the
visual tools or an execution index for the source-test tool.

The supplied evidence remains canonical. This package makes visual causes,
regions, verdicts, findings, composition, variation, acceptance preview, and
source-to-test reach available from another process after collection finishes.
It also holds one previous invocation state in memory so an agent can compare
the evidence it sees now with the evidence it saw one call ago.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | stdio | everything, plus `serve` and `serveReportFile` |
| `./tools` | nothing | visual-report and source-test answers as pure functions over their evidence |
| `./protocol` | nothing | MCP framing, as a pure function from a request to a response |

Two of the three halves are pure, and that is deliberate. The question that
matters — *does this actually help an agent fix it?* — has to stay cheap to ask,
and it stops being asked the moment answering it requires speaking a protocol
over a pipe.

What a producer *wrote* is not here either. The visual report format belongs to
`@variance-authority/report`, and the execution index belongs to
`@variance-authority/sense`. MCP reads both contracts; it owns
neither.

## Give an agent the tests for source

`variance_source_tests` answers the question a coding agent needs before and
after an edit: which named tests reached this source, and how directly? A line
or function query returns tests ordered by minimum observed call-stack depth. A
file query returns every indexed line as compact ranges, including ranges no
test reached.

An integration that owns the current `ExecutionIndex` serves it directly; the
supplier is called for every request so a rerun is visible without restarting
the agent's MCP connection:

```ts
import { SOURCE_TESTS, serve } from '@variance-authority/mcp';
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

The tool takes `file` and optionally one of `line` or `function`. With neither,
it answers the whole file. It distinguishes an indexed range reached by no test
from a line absent from the execution index. The index is supplied by the test
collector or editor integration; MCP does not manufacture coverage or control
the test runner.

## Diff the current state

A **subject** is whatever data the server currently holds and answers questions
about — a `RunReport` for the visual tools, or an `ExecutionIndex` for the
source-test tool above. (Inside a `RunReport`, each individually observed
rendering, such as `story:card--dark`, is also called a subject; the tool
contract below works at that finer grain.)

`variance_diff` compares the current supplied subject with the subject from the
previous successful tool call. The first call records the current state and says
there is nothing to compare. Each successful call then replaces that one value.

The value lives only in the MCP process. It is not written to disk, does not move
or replace a baseline, and disappears when the process exits. Initialization,
tool discovery, invalid calls, and failed calls do not replace it.

`diffState(before, after)` exposes the same JSON-compatible state comparison
without MCP framing.

## Run the report server

Install it wherever the MCP client will launch it from:

```bash
npm install @variance-authority/mcp
```

No install is needed to just run the published binary:

```bash
npx variance serve            # via the CLI, reading .variance/run.json
npx variance-authority-mcp .variance/run.json    # directly
```

```jsonc
// claude_desktop_config.json, or any MCP client
{
  "mcpServers": {
    "variance": { "command": "npx", "args": ["variance-authority-mcp", ".variance/run.json"] }
  }
}
```

Skip this package if there is no MCP client in the loop: running the suite and
reading its output yourself is `@variance-authority/cli` (`variance run`,
`variance accept`), with no server or protocol involved. Reach for this package
only to hand an already-finished run, or an execution index, to an agent that
speaks MCP.

## Visual report tool contract

Eleven tools, all answering from the artifact and **never re-running anything**.
The run may have happened on a pinned machine in CI an hour ago; the questions
are asked wherever the agent is. One compares invocations; the other ten inspect
the current artifact.

A **component** is a named unit inside a rendering, such as `Button`; the same
component can appear inside several subjects, which is what
`variance_composition` and `variance_trace_component` below compare.

```ts
import { toolByName } from '@variance-authority/mcp/tools';

const priorReport = report;
toolByName('variance_summary')?.run(report, {});
toolByName('variance_diff')?.run(report, {}, { previous: priorReport });
toolByName('variance_changes')?.run(report, {});
toolByName('variance_adjudicate')?.run(report, {
  claims: [{ root: 'component:Button', reason: 'new brand accent', maxSubjects: 3 }],
});
toolByName('variance_composition')?.run(report, {});
toolByName('variance_variations')?.run(report, { subject: 'story:card--dark' });
toolByName('variance_changelog')?.run(report, { shape: 'v1:9a3f1c2e04' });
toolByName('variance_describe')?.run(report, { subject: 'story:card--populated' });
toolByName('variance_findings')?.run(report, {});
toolByName('variance_trace_component')?.run(report, { component: 'Button' });
toolByName('variance_explain_verdict')?.run(report, { subject: 'story:card--populated' });
```

| tool | answers | ask it when |
|---|---|---|
| `variance_summary` | how the run came out across every subject, including the ones nobody observed | starting from nothing: *did anything change, and was anything missed?* |
| `variance_diff` | how the current supplied state differs from the previous successful MCP tool invocation | after rerunning or replacing the supplied evidence |
| `variance_changes` | the distinct changes behind the changed subjects, most decidable first, each with the command that settles it | immediately after the summary, before touching any individual subject |
| `variance_adjudicate` | this run against **what you said you were doing**: declared and delivered, moved and undeclared, and declared and never happened | you edited something and are reading your own run — declare before you read the diff |
| `variance_composition` | the run's subjects compared to **each other**: the component graph, the renderings two examples share, and why each component that moved moved — including *nothing here explains it* | a change has no obvious author, or you are about to call something flaky |
| `variance_variations` | the measured difference between a subject and the subject it declares as its parent, such as a feature arm, theme, or viewport | reviewing what a variant changes rather than whether it regressed |
| `variance_changelog` | what accepting this run would write into the baseline record: the lines the commit will carry, and the subjects that would be refused | before proposing an `accept` command, because the record is written once and outlives the run |
| `variance_describe` | what changed inside one subject — regions, components, files | the summary named a subject and you need the detail |
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
this answers about the agent. `variance_changes` can say that `Button` moved in
twelve subjects. It cannot say that `Card` — which the agent believes it just
edited — did not move at all, because a diff has no opinion about what was
supposed to happen. That third arm is where a wrong file, a dead branch, an
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
bands`. `examples/agent-claim` runs the whole
boundary — CLI and this tool, every verdict, one process.

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
same bytes, which of them disagree at one commit, and — for anything that moved
— whether an edited file, a moved token or an edited *caller* accounts for it.

This is also where an unexplained movement gets a **control group**: the
subjects where that same component, with the same props, held — did not move —
the stable states to compare against. Given one, an unexplained movement is
`flake` if the subject also failed to read the same way twice, or `suspect` — a
shortlist, not a verdict — if nobody has read it twice yet.

`variance_summary` labels a subject by what it *is*, which is not always its
verdict. Three subjects can all be `changed` — the pixels did move — and need
three different people:

| label | what happened | what to do |
|---|---|---|
| `unstable` | read twice, seconds apart, nothing changed in between, and the two readings disagreed | fix what moves between readings; the named component and band say where. Do not review the regions — which ones appear was decided by a race |
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

## Serve a custom subject

`serveReportFile(path)` is the whole executable, and `serve(options)` is what it
composes when the report does not come from a file:

| option | what it decides |
|---|---|
| `input` | the `Readable` requests arrive on |
| `output` | the `Writable` responses leave on |
| `served` | the `Served<Subject>` name and tools for the subject; use `REPORTS` for a `RunReport` or supply a set for another serializable subject |
| `subject` | supplies the current subject. A function rather than a value, so a long-lived server picks up a re-run without a restart — an agent that fixes something and asks again should be answered from the new report, not from the one loaded at boot. It may be async, and the request waits for it: a supplier that started a refresh and answered from the previous value would make *this* request the stale one, and this request is the agent that just re-ran |

Both return a function that detaches the server from its streams.

## Stability

**The tool names, their argument shapes and the wording of their answers carry no
compatibility guarantee.** They are answers chosen to be useful to an agent
rather than a published interface, and an answer that turns out to be the wrong
one to give will change without a deprecation. If you need them to hold still,
import `@variance-authority/mcp/tools` behind an adapter of your own and pin the
version.
