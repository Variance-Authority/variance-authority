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

## One method wherever the question lands

Every use follows the same grammar:

**Name the outcome → frame the variance → choose an eye and a vantage → sense
or instrument → read the evidence → act or step back.**

The path is recursive, not linear. An answer can expose a better question. A
missing observation can send you to another vantage. Evidence that cannot
support the intended decision narrows the claim instead of becoming a guess.

### Why — name the outcome

The outcome is the decision or action the work must support: which tests to
run, whether a change is authorized, where two executions parted, what an
interface communicates, or whether an agent knows enough to edit a file.

This is the first boundary. The system does not ask *what can I run?* until it
knows *why should I run it?*

### How — sense what remains; instrument what disappears

Some evidence already exists in source, artifacts, or a running system. Sense
it where it is. Other evidence disappears with the process that produced it.
Instrument that moment and retain the answer.

Neither mode is inherently better. The question decides whether a source
index, a browser observer, an execution trace, a comparison, or an existing
external system should answer it.

### What — choose an eye and a vantage

An **eye** is the capability that can make the relevant distinction: source
reach, accessibility, component provenance, pixels, runtime work, presentation
relationships, or another observation. A **vantage** is where and under which
conditions that eye reads: committed source, a live page, one execution, two
runs, or retained history.

[Eyes](eyes.md) shows how a test's attention reaches the React tree.
[Vantage](vantage.md) shows what a live or unfinished run can reveal. Neither is
a mandatory stage; each is one concrete expression of the grammar.

### Result — earn bounded authority

Evidence earns authority only for the question it answered. It may authorize a
change, select work, attribute a cause, guide an investigation, or support no
conclusion yet. The result always carries its subject, conditions, provenance,
and boundary.

Authority is therefore not certainty about the whole codebase. It is the
standing to make one defensible move without pretending to know more than the
evidence says.

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

## Follow the question, not a pipeline

A software question can cross several boundaries. Each boundary has native
ways to answer it, and no use must cross them all.

| Where the question lands | The answer can come from |
| --- | --- |
| [Run relevant work](run-relevant-work.md) | Reachability, change closure, distance, names, and source structure |
| [Understand an execution](understand-execution.md) | Attention, updates, requests, logs, journeys, and unfinished work |
| [Understand an interface](understand-interface.md) | Accessibility, pixels, geometry, component provenance, and presentation relationships |
| [Explain variance](explain-variance.md) | Baselines, paired runs, variations, divergence, and parting |
| [Compose an observation](compose-observation.md) | State ownership, acquisition material, renderer placement, retention, and consumption |
| Decision and memory | Rules, approvals, attribution, history, and retained evidence |
| Consumption | A report, a test failure, the CLI, MCP, or a workspace API |

The repository supplies an answer at every boundary because gaps otherwise
become guesses, redundant work, or accidental authority. You may fill a role
with another system when it preserves the observation contract: the question
answered, the subject and conditions, the observer's capability, the evidence
and its provenance, and any absence or boundary.

[Choosing a composition](cases.md) starts from the process that already owns
the state. [Surface](surface.md) separates what is captured from where pixels
are made. [Baseline placement](placement.md) separates comparison from storage.
[Operating flows](flows.md) separates the evidence from the place its answer is
consumed.

## Step back before the evidence runs out

The method is always ready to step back. That is how it remains trustworthy in
an ever-changing codebase.

An unavailable reading is absent, never an empty result. A first observation is
`new`, not unchanged. Evidence produced under incompatible conditions is
`incomparable`, not different. A capability that did not observe a band reports
it as unobserved rather than silently clearing it.

When the evidence cannot carry the intended decision, the next move is one of:

- narrow the claim to what was observed;
- widen the observation;
- choose another eye or vantage;
- defer to the person or system that owns the missing authority; or
- refuse the conclusion.

[Instruments](instruments.md) names the reading behind each product claim and
where it stops. [Information model](information.md) defines how those boundaries
survive in retained evidence. [Metrics](metrics.md) defines the population and
denominator behind every measured claim.

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
