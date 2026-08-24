<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/mcp

Use this package when a run report already exists and an MCP client needs to
inspect it. The server reads the report and returns text; it never runs tests,
rerenders a subject, changes a baseline, or infers a report that is not there.

**Requires:** a run report and an MCP client that speaks over stdio.

The report remains the canonical artifact. This package makes its causes,
regions, verdicts, findings, composition, variation, and acceptance preview
available from another process after the run has finished.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | stdio | everything, plus `serve` and `serveReportFile` |
| `./tools` | nothing | the answers, as pure functions from a report to text |
| `./protocol` | nothing | MCP framing, as a pure function from a request to a response |

Two of the three halves are pure, and that is deliberate. The question that
matters — *does this actually help an agent fix it?* — has to stay cheap to ask,
and it stops being asked the moment answering it requires speaking a protocol
over a pipe.

What a run *wrote* is not here either. The report format is
[`@variance-authority/report`](../report), because it has several readers and a
format owned by one of them bends towards that one.

## Run the report server

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

## Tool contract

Ten tools, all answering from the artifact and **never re-running anything**.
The run may have happened on a pinned machine in CI an hour ago; the questions
are asked wherever the agent is. Eight of them hand evidence out, one takes
evidence in, and one answers about a command nobody has run yet.

```ts
import { toolByName } from '@variance-authority/mcp/tools';

toolByName('variance_summary')?.run(report, {});
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

The declaration has to come first. The tool takes claims as an argument and
derives none, so an agent that reads `variance_changes` and submits the answer
back as its intent is scoring the run against itself — visibly, because the
transcript shows the order. Nothing here can prevent that; what it can do is
never do it *for* the agent. Over-claiming is not a way out either: a claim that
reaches more subjects than it declared comes back `overreached`, so the agent
that widens its claims to avoid *this moved and you did not mention it* walks
into *its reach is not what you said*. Both directions cost something, which is
what makes the declaration worth reading.

A claim carrying a field this resolution cannot check is named rather than
dropped. An agent told `delivered` about a band nothing looked at has been told
something the run never established, so the answer ends `Not checked here:
bands`. [`examples/agent-claim`](../../examples/agent-claim) runs the whole
boundary — CLI and this tool, every verdict, one process.

`variance_changelog` is the only one that answers about something that has not
happened. A baseline update is explained in the commit that carries it or in a
review database, both written at the moment of acceptance and never again — so
an agent that runs `accept` to find out what the record says has already written
it. The preview renders the record's own lines, through the same function that
renders them into the commit, over the subject set the same rules select. A tool
that phrased its own summary would be a second account of the update, edited
separately from the first, and the one the agent read would not be the one that
survived.

It stops short of the trailers, and that is the point rather than an omission. A
trailer is a record, and records exist because somebody accepted something; one
copied out of a preview would attribute a baseline to a promotion that never
happened.

`variance_composition` is the only one that reads the other axis. Everything
else compares a subject to its baseline — two revisions, one thing. This
compares the run's subjects to each other, at one commit, because **a
visual-regression example is a component built from components**: the example
*is* a component at a boundary, and the same component appears again, with the
same or different props, inside larger examples. Once those boundaries are
addressable the run can say which of its examples are watching literally the
same bytes, which of them disagree at one commit, and — for anything that moved
— whether an edited file, a moved token or an edited *caller* accounts for it.

It is also where a flake gets named, and it can be named there because that is
where the control group is. A movement nothing explains, in a subject that also
failed to read the same way twice, is `flake`; the same movement in a subject
nobody has read twice is `suspect`, which is a shortlist and not a verdict —
the position in [`flakiness.md`](../../docs/flakiness.md) has not moved. Beside
each one it prints the subjects where that same component, with the same props,
**held**. Those are the *stable states to refer to*, and without them
"unexplained" is a shrug rather than a finding.

`variance_summary` labels a subject by what it *is*, which is not always its
verdict. Three subjects can all be `changed` — the pixels did move — and need
three different people:

| label | what happened | what to do |
|---|---|---|
| `unstable` | read twice, seconds apart, nothing changed in between, and the two readings disagreed | fix what moves between readings; the named component and band say where. Do not review the regions — which ones appear was decided by a race |
| `order-dependent` | the difference is gone when the subject is collected with nothing else in the world | do not change the component; bisect run order to find the subject that writes the state this one reads |
| `changed` | it survived both | review it |

A fourth state is deliberately *not* on that list. A subject whose two readings
differed entirely in bands its declared sensitivity level does not assert on is
listed under **not asserted on** and carries no instruction: a route declared
`layout` said in its config that it does not assert on what the page is painted
with, so a clock inside it is a fact about the page rather than a defect in it.
It is named and counted anyway, with the rule that absorbed it, for the same
reason `ignored` is never spelled `unchanged` — a declaration nobody re-reads is
how a suite quietly stops watching something.

`accept` refuses the first two, so an agent that proposes promoting one is
proposing something that will be rejected. The precedence is the order above:
instability disqualifies the clean-world answer, because that answer's whole
inference is *the clean reading differs from the shared one, therefore the world
moved it* — which is only evidence on a subject whose two readings would
otherwise have agreed.

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
a run with unobserved subjects never reads as clean. `notObserved` distinguishes
`excluded` from `failed`, and a malformed entry is refused rather than defaulted:
guessing `excluded` turns a coverage hole into a decision somebody made, and
guessing `failed` turns every deliberate exclusion into a permanently red build.

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
