# Ask more of the run you already have

A red build from `toHaveScreenshot`, Chromatic, Percy or Argos hands back a
count of differing pixels and two images; every question after that — which
component drew the region, whether the same state reads the same way twice,
whether your edit could reach it at all — is answered by somebody opening the
diff. This page is about those later questions, and about answering them from
readings the run already took rather than from a second tool asked to take them
again.

**Evidence** is what one of those readings retained: a
[source index](source-index.md), a record of which tests covered which code, a
rendered document, a stored baseline, or the history of previous runs. Each is
kept with the question it answered and the conditions it was read under, so a
later question can be put to it directly.
A **subject** is one named UI state a run observes and can observe again — a
story, a route, a fixture — under an id that survives a rename.

## Read a run back

`variance ask` reads a completed report and answers in text. It never renders,
never re-runs and never promotes a baseline, and every answer exits `0` —
gating is what `variance run`, `variance report` and `variance adjudicate` do,
and those exit `1` when something needs review and `2` on an operator error.

```bash
variance ask            # the questions, their arguments, and what each answers
variance ask summary    # the last run, from the configured report
```

The listing reads no configuration, so it answers before any run exists. The
summary is the entrance to the rest: it prints how many subjects were observed
out of how many were planned, the renderer, engine, platform and device scale
that drew them, a count per verdict, one line per subject that needs attention,
and then every subject the run meant to see and did not — each marked
`[failed]`, `[excluded]` or `[unreached]`. A subject that was planned and never
observed is named rather than counted, so silence about it cannot be read as a
pass.

Two of those attention lines are not verdicts about a component:

- `[unstable]` — the subject was read twice, seconds apart, with nothing changed
  in between, and the two readings disagreed. The line names the component that
  differed and the band it differed in (`content`, `geometry`, `token`, `a11y`
  or `texture`), and `accept` refuses the subject.
- `[order-dependent]` — the subject changed under the shared session and matched
  its baseline when collected alone. The writer of the shared state is not
  named; module-level state is outside anything a render can see.

The summary closes an unstable finding with the command that tests a fix against
one subject instead of the suite:

```bash
variance run --subjects '<subject>' --flakes
```

It exits `1` while two readings still disagree, even with every verdict green.

Narrow from the summary with `changes`, `describe`, `explain-verdict`,
`trace-component`, `findings`, `composition` or `variations`; each takes only
the arguments its own question declares and refuses another by name. For one
test rather than one subject, `variance distill --test <id>` reads portable
[Eyes](eyes.md) and [Sense](../packages/sense) evidence without a report at all.
[Asking from the command line](agent-cli.md) covers the full set.

## Five ways in, no required pipeline

Each entrance answers a different kind of question. They can share evidence,
but none is a prerequisite for another.

| Entrance | The decision it supports |
| --- | --- |
| [Run relevant work](run-relevant-work.md) | What can this change reach, what has exercised it, and what should run first? |
| [Understand an execution](understand-execution.md) | What did a run address, traverse, update, announce, or leave unfinished? |
| [Understand an interface](understand-interface.md) | What does one live state communicate through semantics, structure, and presentation? |
| [Explain variance](explain-variance.md) | Where did readings differ, what caused it, and who is best placed to respond? |
| [Compose an observation](compose-observation.md) | Which host, surface, renderer, store, and consumer fit this question? |

One edit may need only source reach. One stalled run may need only a live view.
One interface may need structural reading without ever acquiring a baseline.
Rendered comparison combines several capabilities, but it is only one way to
use them.

## Bring the tools you already trust

An **observation** is one reading with the context that makes it usable later.
An existing runner, collector, index, renderer, store, or review system can
supply one when it reports:

- the question the observation answered;
- the subject and conditions it read;
- the capability of the observer;
- the evidence and its [provenance](attribution.md); and
- any absence, incompatibility, or authority boundary.

Each boundary in the system has an answer behind it, because a boundary without
an observation cannot support a conclusion. Which product produced that answer
is open. [Choose the operating model that fits](comparison.md) sets the capture
and operational contracts side by side with Percy, Chromatic, Argos and
Applitools.

## Decisions, memory, and consumers

Observation does not decide by itself. Rules and approvals state what the
evidence permits; [changelog](changelog.md) retains why an accepted baseline
changed; [history](history.md) finds causes that recur; and [sharing](sharing.md)
moves evidence between systems without handing over the authority to
interpret it.

The answer can arrive as a report, a test failure, the CLI, MCP, or a workspace
API. [Agent workflows](agent-workflows.md) route a question to retained evidence, a live
run, a workspace API, or source search according to what is available. The
[question map](agent-questions.md) names the answers without implying that an
agent, or a person, must use all of them.

## Read the mechanism when you need it

[Choose from the state you already have](cases.md) starts from the process that already owns
the state. [Surface](surface.md) separates what is captured from where pixels
are made. [Baseline placement](placement.md) separates comparison from storage.
[Operating flows](flows.md) separates the evidence from the place its answer is
consumed.

The [architecture](architecture.md), [source structures](source-structures.md),
and [execution record](execution-record.md) own the system boundaries and
retained formats. [Performance](performance.md), [native code](native-code.md),
and the [package reference](https://variance-authority.dev/reference/packages) own costs and callable interfaces.
Those are reference routes beneath the field, not more steps in the method.
