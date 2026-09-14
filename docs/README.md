# Change creates variance. Evidence earns authority.

Software changes faster than any fixed description of it. The same edit can be
safe for one outcome, relevant to another, and unknowable from a third vantage.
Running everything does not resolve that uncertainty. It only produces more
activity.

Variance Authority is a flexible method, backed by composable evidence tools,
for deciding what a changing codebase gives you reason to do. It starts with
the outcome you need, follows the question across source, execution, interface,
and history, and stops at the boundary of what the evidence can support.

There is no required first instrument and no final destination. Visual review,
test selection, live-run diagnosis, presentation analysis, and agent-facing
code search are different uses of the same method. Adopt the parts your
question crosses. Keep the systems that already answer the rest.

## Read the overview at the depth you need

The overview has three pages because orientation, method, and coverage answer
different questions.

| Page | The question it answers |
| --- | --- |
| **Why Variance Authority** — this page | What problem the method exists to solve, and where can I enter? |
| [Follow the reasoning loop](reasoning.md) | How does a question become an observation and a bounded result? |
| [See the evidence field](evidence-field.md) | How do the aspects fit together without becoming a required pipeline? |

Read only as far as the decision in front of you requires. The aspect pages
below are the next layer; the mechanism pages beneath them are reference.

## Enter from the work in front of you

Variance Authority is the whole field, but every use is local. These entrances
do not form a maturity model or a pipeline.

### One edit should not run the whole suite

Begin with the decision to run only the work the edit can reach.
[Test selection](selecting.md) combines source reach with observed execution.
[Distance](distance.md) puts the nearest selected tests first.
[Source reach](source.md) explains the mechanism underneath, and the
[source index](source-index.md) defines the shared generation those readings
use.

### A run has not finished

Begin with the outcome the stalled run prevents. [Vantage](vantage.md) retains
what each test heard, from which realm, and which work opened but did not close.
[Journeys](journeys.md) follow the regions an execution entered across
processes. [Runtime scenarios](scenarios.md) compare state transitions and name
the Act where two executions part.

### An interface has no approved baseline

Begin with the question the interface must answer now.
[Presentation intelligence](presentation.md) reads grouping, separation,
alignment, and emphasis from one interface. [Eyes](eyes.md) connects addressed
elements to the tree that produced them. [Framework evidence](framework.md) and
[observability](observability.md) retain what would otherwise vanish when the
page closes.

### A result changed and needs an explanation

Begin with the difference that matters to the decision.
[Attribution](attribution.md) traces a changed region to a stable cause.
[Parting](parting.md) locates where two readings diverged.
[Flakiness](flakiness.md) assigns unstable variance to the party able to deal
with it, while [stabilization](stabilization.md) defines what must be held still
before a subject is read. [Composition](composition.md),
[variations](variations.md), [sensitivity](sensitivity.md), and
[ignores](ignores.md) control how repeated, related, meaningful, and excluded
differences enter the decision.

### A person or agent must act in unfamiliar code

Begin with the authority the actor needs. [Agent workflows](agents.md) route a
question through retained evidence, a live run, a workspace API, or source
search according to what is already known. The [question map](agent-questions.md)
names the available answers. The [lexicon](lexicon.md) keeps their subjects and
boundaries stable across tools.

## Choose the first answer you need

| Pressure | Start here |
| --- | --- |
| Run only what a source change can affect | [Select tests](selecting.md) |
| See the nearest failures first | [Order by distance](distance.md) |
| Understand a stalled or live run | [Choose a vantage](vantage.md) |
| Ask a question the test did not | [Retain runtime evidence](observability.md) |
| Understand what an interface communicates | [Read presentation](presentation.md) |
| Trace a visible change to code | [Attribute it](attribution.md) |
| Separate a change from instability | [Find where readings part](parting.md) |
| Add durable rendered comparison | [Observe one state](start.md) |
| Replace an existing screenshot suite | [Map the existing workflow](replacing.md) |
| Give an agent evidence to act | [Choose an agent workflow](agents.md) |

If durable rendered comparison is your question, the first complete loop is one
subject through observation, explicit acceptance, and a second reading. The
[first-observation guide](start.md) builds that loop without requiring remote
infrastructure or suite-wide policy. It is one entrance to the method, not its
definition.

## Read a report from subject to verdict

Rendered comparison is one rich use of the method. These nouns carry its model
from observed subject to bounded verdict.

| Word        | What it means                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **subject** | One UI state a run addresses — a story, a route, a fixture, or a value — identified by an id that survives a rename.                                                                                                                  |
| **band**    | Which kind of difference a delta is: `a11y`, `geometry`, `token`, `content`, `texture`, loudest first. The band decides how loudly it is reported.                                                                                    |
| **digest**  | One hashed dimension of a component instance — `structure`, `semantics`, `text`, `style`, `geometry`, `wiring`. Two equal digests are a match, never a resemblance.                                                                   |
| **root**    | The cause a change is attributed to, such as `component:Button` or `token:--va-color-accent`. Stable across subjects and builds, which is what lets an approval keep applying.                                                        |
| **cluster** | Regions that share a semantic fingerprint — the kind of root, the shapes of the deltas, and the component responsible — so one decision covers all of them and reaches nothing else.                                                  |
| **docket**  | What a run leaves for a decision: the roots nobody declared, ranked by cause rather than by area.                                                                                                                                     |
| **verdict** | The one word a subject ends in — `unchanged`, `inherited`, `authorized`, `needs-review`, `violation`, or `unexplained`. A band a profile could not observe reports `unobserved`, which is not a verdict and never collapses into one. |

Boundary states such as `new`, `incomparable`, and not observed are not empty
verdicts. They mean, respectively, that no approved baseline exists, the
available evidence cannot be compared, or the run did not obtain an
observation.

## Check a claim at its owner

[Architecture](architecture.md) describes the system boundaries.
[Source structures](source-structures.md) and the
[execution record](execution-record.md) define the retained source and runtime
answers. [What a run costs](performance.md) gives measured timings, and
[where the native code is](native-code.md) defines which costs a rewrite can
reach. The [package reference](../packages) owns the callable interfaces.
