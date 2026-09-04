# Start with the decision

Variance Authority answers questions about rendered software from evidence
produced inside a suite you control. Begin with the decision the run must
support; the state owner, capture boundary, and retained material follow from
that question.

## Put one state under observation

The smallest complete path is one subject through one review loop. The host
already knows how to reach the state. The integration gives that state a stable
id and a bounded root, reads it, and compares it with an approved baseline.

The first durable reading is `new`, not unchanged. Review and explicitly accept
the candidate, then read the same subject again. An `unchanged` result closes the
loop: acquisition, renderer identity, baseline lookup, and reporting agree for
that subject.

[Observe one state end to end](start.md) before adding remote infrastructure,
suite-wide selection, or policy. The guide branches to the setup recipe for the
process that already owns the state.

## Continue from the question you have

### A region moved; what caused it?

Follow [pixel-to-source attribution](attribution.md) from a changed rectangle to
the element and component that own it, and to `file:line` when provenance is
available. When one source change reaches several subjects,
[composition](composition.md) folds their evidence into one cause-led decision.
[Ignores](ignores.md) and
[variations](variations.md) cover intentional differences without erasing the
rest of the subject.

### The same input did not produce the same state

[Parting](parting.md) compares two readings at the point their inputs diverge.
[Flakiness](flakiness.md) sorts every known cause of variance by who deals with
it — the tool, the environment key, one decision, or nobody — says what the last
group costs you, and narrows what is left to a component, a boundary, an input,
an Act, an element, or a region of source.
[Stabilization](stabilization.md) defines what is held still before a subject is
read.

### One edit should not pay for the whole suite

[Source reach](source.md) establishes what a change could affect before a
browser opens. [Test selection](selecting.md) combines that static answer with
observed execution, and the [source index](source-index.md) defines the
generation both readings share.

### There is no approved image to compare

An assertion is a question written before the run, and the answer is one bit. The
execution knew a great deal more, and all of it is reachable at a breakpoint, on
a live page, with somebody watching — three conditions CI never meets.
[Ask a question the test did not ask](observability.md) is the record taken
instead: gathered while the page is alive, kept once it is gone, with the test
unchanged.

Four instruments read the run in front of you and open no baseline at all.
[Eyes](eyes.md) records which elements a test addressed and attributes each to
the React tree that produced it. [Vantage](vantage.md) makes an unfinished run
readable — what each test heard, from which realm, and which work opened and
never closed. [Runtime scenarios](scenarios.md) compare state transitions and
name the Act where two executions part.
[Presentation intelligence](presentation.md) reads grouping, separation,
alignment, and emphasis from one interface. A
[divergence](composition.md) is the same question one layer down: one props
digest producing more than one rendering at a single commit, each rendering
after the first naming the input that changed it.

### An existing screenshot suite already owns the workflow

[Replacing a screenshot suite](replacing.md) maps an existing host and baseline
store to the corresponding composition. [Replacement gates](gates.md) define
the questions a substitute must answer; the [product comparison](comparison.md)
keeps those questions separate from feature count.

## Read a report from subject to verdict

The report starts with the observed state, keeps independently
observed signals separate, classifies differences by severity, attributes them
to stable causes, and leaves only undecided causes for review. These nouns carry
that model throughout the documentation.

| Word        | What it means                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **subject** | One UI state a run addresses — a story, a route, a fixture, or a value — identified by an id that survives a rename.                                                                                                                  |
| **band**    | Which kind of difference a delta is: `a11y`, `geometry`, `token`, `content`, `texture`, loudest first. The band decides how loudly it is reported.                                                                                    |
| **digest**  | One hashed dimension of a component instance — `structure`, `semantics`, `text`, `style`, `geometry`, `wiring`. Two equal digests are a match, never a resemblance.                                                                   |
| **root**    | The cause a change is attributed to, such as `component:Button` or `token:--va-color-accent`. Stable across subjects and builds, which is what lets an approval keep applying.                                                        |
| **cluster** | Regions that share a semantic fingerprint — the kind of root, the shapes of the deltas, and the component responsible — so one decision covers all of them and reaches nothing else.                                                  |
| **docket**  | What a run leaves for a decision: the roots nobody declared, ranked by cause rather than by area.                                                                                                                                     |
| **verdict** | The one word a subject ends in — `unchanged`, `inherited`, `authorized`, `needs-review`, `violation`, or `unexplained`. A band a profile could not observe reports `unobserved`, which is not a verdict and never collapses into one. |

An observation also reports boundary states such as `new`, `incomparable`, and
not observed. They are not empty verdicts: respectively, no approved baseline
exists, the available evidence cannot be compared, or the run did not obtain an
observation.

## Choose the boundary the suite owns

Four independent choices determine what the answer can mean. Changing one does
not silently choose the others.

| Decision                                                                                  | Start here                         |
| ----------------------------------------------------------------------------------------- | ---------------------------------- |
| Which process reaches the state and decides it is ready?                                  | [Choosing a composition](cases.md) |
| Does acquisition keep a document or an already-painted raster, and where are pixels made? | [Surface](surface.md)              |
| Is evidence compared inside one run or against a durable baseline, and who stores it?     | [Baseline placement](placement.md) |
| Does the answer stay in a test, become a report, reach a reviewer, or answer an agent?    | [Operating flows](flows.md)        |

The paths join at observation, retention, and reporting; they do not produce
identical evidence. Browser accessibility, component provenance, resource
closure, and in-place paint are present only when the chosen surface supplies
them. An unavailable reading is absent, not represented as an empty
result.

## Check a claim at its instrument

[Instruments](instruments.md) names the reading behind each product claim and
the boundary where that reading stops. [Metrics](metrics.md) defines the
numerator, denominator, and population for reported measurements.
[Architecture](architecture.md) describes the package boundaries after the
reader already knows which answer they need.
