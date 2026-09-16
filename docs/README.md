# Start with the question you need answered

A change lands and the useful question is rarely just _did the suite pass?_ You
may need to know which tests matter, why a page changed, what a stalled run is
waiting for, or whether several differences share one cause. Running more work
can produce more output without making any of those decisions easier.

**Change creates variance. Evidence earns authority.** A useful run shows which
action its observations support.

Variance Authority helps you use evidence already present in source, tests,
pages, and previous runs. It reads that evidence where it lives or retains it
when it would otherwise disappear, then makes the limits of the answer visible.
You can use one capability beside the tools you already have or connect several
when the question crosses their boundaries.

## What Variance Authority lets you do

Choose the situation that looks familiar. Each route stands on its own.

<div class="doc-link-grid doc-link-grid--capabilities">
<a class="doc-link-card doc-link-card--compact" href="run-relevant-work.md">
<span>Select</span>
<strong>Run less</strong>
<p>Choose only the tests a change can reach, then start with the nearest.</p>
<em>Run relevant work →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="start.md">
<span>Observe</span>
<strong>Run visual regression</strong>
<p>Compare one stable UI state through capture, review, and explicit acceptance.</p>
<em>Observe one state →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="vantage.md">
<span>Watch</span>
<strong>See a run alive</strong>
<p>Ask what is running, speaking, waiting, or unfinished before it exits.</p>
<em>Choose a vantage →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="understand-execution.md">
<span>Retain</span>
<strong>Ask beyond assertions</strong>
<p>Keep what the test addressed, where it travelled, and what updated.</p>
<em>Understand execution →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="understand-interface.md">
<span>Read</span>
<strong>Understand one interface</strong>
<p>See grouping, alignment, emphasis, and ownership without a baseline.</p>
<em>Understand an interface →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="explain-variance.md">
<span>Explain</span>
<strong>Turn changes into causes</strong>
<p>Find where readings parted and which differences share one cause.</p>
<em>Explain variance →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="compose-observation.md">
<span>Compose</span>
<strong>Build the observation you need</strong>
<p>Choose the host, surface, renderer, store, and consumer independently.</p>
<em>Compose an observation →</em>
</a>
<a class="doc-link-card doc-link-card--compact" href="agent-workflows.md">
<span>Guide</span>
<strong>Help the next person act</strong>
<p>Let a person or agent ask source, live-run, comparison, and code-search questions.</p>
<em>Choose an agent workflow →</em>
</a>
</div>

These capabilities share a way of working: begin with the decision in front of
you, gather only the evidence that can inform it, and say clearly where that
evidence stops. Visual review, test selection, live-run diagnosis, presentation
analysis, and code search can be used independently. Keep the systems that
already answer part of the question and add only what is missing.

## Get oriented at the depth you need

The overview has three pages because orientation, method, and coverage answer
different questions.

| Page | The question it answers |
| --- | --- |
| **Find your starting point** — this page | Which problem can I solve, and where should I enter? |
| [Follow the reasoning loop](reasoning.md) | How does a question become an observation and a bounded result? |
| [Use the evidence you already have](evidence-field.md) | How do the capabilities fit together without becoming a required pipeline? |

Read only as far as the decision in front of you requires. The pages below
organize the available capabilities; the mechanism pages beneath them are
reference.

## Begin with the work in front of you

You do not need to adopt a complete platform before solving one problem. These
are independent entrances, not stages of a rollout.

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
[Flakiness](flakiness.md) connects unstable variance to the team or system best
placed to fix it, while [stabilization](stabilization.md) defines what must be held still
before a subject is read. [Composition](composition.md),
[variations](variations.md), [sensitivity](sensitivity.md), and
[ignores](ignores.md) control how repeated, related, meaningful, and excluded
differences enter the decision.

### Someone needs to act in unfamiliar code

Begin with the question they need answered. [Agent workflows](agent-workflows.md) route
it through retained evidence, a live run, a workspace API, or source search
according to what is already known. The [question map](agent-questions.md)
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
| Give an agent evidence to act | [Choose an agent workflow](agent-workflows.md) |

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
