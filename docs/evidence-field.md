# Use the evidence you already have

A useful answer may need evidence from source, a running test, the rendered
interface, a previous comparison, or retained history. Variance Authority keeps
those sources compatible so you can follow a question across them without
replacing the tools that already serve you well.

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

The system supplies an answer for each boundary because a boundary without an
observation cannot support a conclusion. It does not require every answer to
come from Variance Authority.

An existing runner, collector, index, renderer, store, or review system can
fill a role when it preserves the observation contract:

- the question the observation answered;
- the subject and conditions it read;
- the capability of the observer;
- the evidence and its provenance; and
- any absence, incompatibility, or authority boundary.

This lets the parts work together without requiring one product to own the
whole workflow.

## Decisions, memory, and consumers

Observation does not decide by itself. Rules and approvals state what the
evidence permits; [changelog](changelog.md) retains why an accepted baseline
changed; [history](history.md) finds causes that recur; and [sharing](sharing.md)
moves evidence between systems without moving the authority to interpret it.

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
and the [package reference](../packages) own costs and callable interfaces.
Those are reference routes beneath the field, not more steps in the method.
