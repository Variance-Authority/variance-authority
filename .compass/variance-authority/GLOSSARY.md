# Glossary — variance-authority

## **Subject**

### Meaning

The thing observed and compared: a named, stably identified state of an
interface, or a named value. Every run compares a subject only to itself.

### Bounded context

[**Observation**](./DOMAIN.md#observation)

### Product appearance

A story, a route, a locator, or a captured value, named in the run's plan and
in every line of the report.

### Implementation aliases

`SubjectRef`, `PlannedSubject`

## **Reading**

### Meaning

Two senses, carried by one word.

#### One act of observation of one subject

A capture, a **profile**, and whatever **provenance** the reader could recover.

#### One rendering of the run report for one audience

Text, a self-contained page, a comment body, a set of tools an agent can call. A
rendering renders the durable value and never re-derives it.

### Bounded context

[**Observation**](./DOMAIN.md#observation) for the act of observing;
[**Report**](./DOMAIN.md#report) for the rendering of the artifact.

## **Variation**

### Meaning

A subject declared to be a variation of another subject, so the two are
compared to each other and the difference between them is digested. Nothing
names what kind of variation it is.

### Bounded context

[**Observation**](./DOMAIN.md#observation)

### Product appearance

A dark-mode subject beside its light-mode parent, described in the report and
never adjudicated. A run whose only news is a variation is a green run.

### Implementation aliases

`variance-parent:` tag, `names.axes` grammar

## **Profile**

### Meaning

A declaration of what an observer was capable of observing, recorded
independently of what it did observe.

### Bounded context

[**Observation**](./DOMAIN.md#observation)

### Product appearance

The reason a browserless reading and a browser reading are never compared to
each other, and the reason a reader that cannot see layout says so rather than
saying nothing moved.

### Implementation aliases

`ObservationProfile`, `jsdom` profile, `chromium` profile

## **Render document**

### Meaning

A subject's reading serialized so it can be painted somewhere else: markup, the
styling that can actually reach it, the reconstructed ancestor frame, the
inherited floor, the viewport, and the declared fonts.

### Bounded context

[**Observation**](./DOMAIN.md#observation)

### Product appearance

What a browserless test process writes and a later run paints. Portable only
when it closes over every resource it needs, and refused rather than written
when it cannot.

### Implementation aliases

`RenderDocument`, `CaptureArtifact`

## **Semantic snapshot**

### Meaning

The normalized, comparable form of a reading: the tree, its accessible
meanings, its applicable styling, its geometry where a layout engine existed,
and the authorship of every node.

### Bounded context

[**Observation**](./DOMAIN.md#observation)

### Product appearance

The artifact an inspection rule can decide from, offline, months later.

### Implementation aliases

`SemanticSnapshot`, `RawCapture` before normalization

## **Digest**

### Meaning

A hash over one dimension of a subject's reading: structure, semantics, text,
style, geometry, or wiring.

### Bounded context

[**Observation**](./DOMAIN.md#observation)

### Product appearance

What lets a run answer *nothing moved* without painting anything.

### Implementation aliases

`Digest`, `documentDigest`, `renderHash`

## **Band**

### Meaning

Two senses, carried by one word.

#### The kind of information that moved

Five, ordered loudest first: accessibility, geometry, token, content, texture.
Change frequency and change importance run opposite to each other — an
accessible name almost never moves and is a defect when it does; anti-aliasing
moves constantly and never matters.

#### One of the dimensions a reading is hashed along

A value belongs to a band only if reading the same page twice leaves it unmoved;
if it moved, it is a finding rather than a band.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication) for the frequency bands;
[**Observation**](./DOMAIN.md#observation) for the hashed bands.

### Product appearance

The word every line of a report is qualified by, and the axis a sensitivity
level is declared against.

### Implementation aliases

`Band`, `InstabilityBand`, `BANDS`

## **Impact**

### Meaning

Whether a change can move anything: layout or paint. A second axis, orthogonal
to **band** — a spacing token is a token change with layout impact, a colour
token is a token change with paint impact.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication)

### Product appearance

The distinction that stops *one CSS edit* from being one sentence.

## **Component hash**

### Meaning

The digest set covering one component's own contribution to a reading: the
nodes whose nearest enclosing boundary is that component, with any nested
component appearing only as a named placeholder.

### Bounded context

[**Observation**](./DOMAIN.md#observation)

### Product appearance

What a baseline carries so that cause can be separated from collateral wherever
the baseline is copied.

### Implementation aliases

`ComponentHash`, `componentInstances`

## **Provenance**

### Meaning

Who authored a rendered node and where. Two upward edges that neither derives
the other: **enclosure**, the component whose boundary contains this one, and
**authorship**, the component that wrote the element and therefore holds its
inputs.

### Bounded context

[**Observation**](./DOMAIN.md#observation)

### Product appearance

The difference between blaming a layout primitive nobody edited and naming the
component somebody did.

### Implementation aliases

`Provenance`, `owners`, `createdBy`, `within`

## **Call site**

### Meaning

The file, line and column that wrote an element, carried on the element until
it reaches the rendered node.

### Bounded context

[**Observation**](./DOMAIN.md#observation)

### Product appearance

The `file:line` at the end of every attributed finding. It survives
minification, which component names do not.

### Implementation aliases

`CallSite`, `_debugSource`, `_debugStack`

## **Renderer identity**

### Meaning

The content hash of every input that can reach a pixel: engine, platform,
scale, fonts, the stabilization recipe, and the ordered rasterization
arguments.

### Bounded context

[**Identity and retention**](./DOMAIN.md#identity-and-retention)

### Product appearance

Why a baseline taken on one machine is *incomparable* on another rather than
red, and why the store is partitioned so the wrong baseline is not where the
lookup looks.

### Implementation aliases

`RenderIdentity`, `Identity`, environment key

## **Raster**

### Meaning

An image of a subject, taken under a declared **renderer identity**, together
with what the document it came from said.

### Bounded context

[**Identity and retention**](./DOMAIN.md#identity-and-retention)

### Product appearance

The `.png` and the sidecar beside it. A candidate whose sidecar cannot be read
is refused rather than reconstructed.

### Implementation aliases

`Raster`, sidecar, `.after.json`

## **Baseline**

### Meaning

The retained prior reading of one subject under one identity, carrying the
component hashes it was painted from.

### Bounded context

[**Identity and retention**](./DOMAIN.md#identity-and-retention)

### Product appearance

What a run compares against, and the only thing an approval ever moves.

## **Candidate**

### Meaning

The freshly observed side of a comparison.

### Bounded context

[**Identity and retention**](./DOMAIN.md#identity-and-retention)

### Product appearance

The image a run produced and a person may promote. A subject with no candidate
cannot be decided.

## **Verdict**

### Meaning

The judgement for one subject in one run. A green verdict is never one word.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication)

### Product appearance

Per subject, one of `unchanged`, `changed`, `new`, `incomparable`, `ignored`.
`unstable` and `order-dependent` are carried beside that word rather than
substituted for it, because a subject reported green by a run that also found it
unstable is a different object from a subject reported green. **Not observed**
is not one of these values: a subject nobody looked at has no verdict to hold,
which is why it is stated separately and by name.

Per band, a second and narrower vocabulary decides what a movement was allowed
to be — `unchanged`, `inherited`, `authorized`, `needs-review`, `violation`,
`unexplained` — with `unobserved` standing beside it, outside the severity order
and unable to block, for the same reason.

### Implementation aliases

`RasterVerdict` for the per-subject word, `Verdict` and `BandOutcome` for the
per-band one. They are two vocabularies, not two names for one.

## **Ignored**

### Meaning

Green, and deliberately never spelled *unchanged*: a subject whose every
difference was absorbed by a declared rule.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication)

### Product appearance

The word that lets a suite answer how much of its green it earned and how much
it declared.

## **Incomparable**

### Meaning

The answer when two readings were produced under identities that may not be
compared, or when one side has evidence the other does not.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication)

### Product appearance

Never red and never green. Comparing anyway would be a false claim of sameness.

## **Unobserved**

### Meaning

Nobody looked. Distinct from *looked and found nothing*, everywhere, in both
directions.

### Bounded context

[**Observation**](./DOMAIN.md#observation)

### Product appearance

Omitted geometry under a reader with no layout engine; an absent cause list; a
window with no rate; a suite that never announced. Absent is not empty.

## **Cause**

### Meaning

The originating change: the component whose own content moved, as opposed to
everything that moved because of it.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication)

### Product appearance

What a report leads with.

### Implementation aliases

`Cause`, `Moved`, root

## **Place**

### Meaning

Where in a **subject** something is, named by a thing rather than by a
magnitude: the path to a subtree. A rectangle is not a place — it stops covering
what it was drawn around the first time the layout moves, and a selector does
not.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication)

### Product appearance

The `where` beside the component in every attributed region, and the half of an
**ignore** that is not a **fingerprint**.

## **Cluster**

### Meaning

Collateral grouped under one **cause**, so that one token and everything that
moved because of it are one review item with a count.

### Bounded context

[**Review**](./DOMAIN.md#review)

## **Docket**

### Meaning

The cross-subject aggregation of causes: the reviewer's agenda for a run.

### Bounded context

[**Review**](./DOMAIN.md#review)

## **Ignore**

### Meaning

A declaration that a difference will not be looked at, naming a place — a
subtree — or a shape — a difference **fingerprint** — and never a rectangle
and never a bare band.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication)

### Product appearance

A rule with a mandatory reason and an optional expiry, accounted for in the
ledger even when it absorbed nothing.

## **Fingerprint**

### Meaning

The digest of a difference with its position and values removed, so the same
artifact anywhere in a subject digests the same.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication)

### Product appearance

What lets one approval promote one change across every subject it reached, and
refuse the ones where something else also moved.

## **Sensitivity**

### Meaning

A declaration of which **bands** a subject is asserted on at all: strict,
layout, or content.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication)

### Product appearance

The cheap exit before isolation, and a ledger line even when it matched
nothing.

## **Instrument**

### Meaning

A controlled comparison that varies exactly one thing and holds the rest. The
system is a set of them: baseline comparison varies the commit; a second reading
varies time; an isolated reading varies the world; composition varies the
subject; a variation varies one declared axis; the record varies the run.

### Bounded context

[**Stability**](./DOMAIN.md#stability)

### Product appearance

One vocabulary across all of them: component, band, `file:line`.

## **Second reading**

### Meaning

A deliberate re-observation. One holds the world and advances time, answering
*does this subject move on its own*. The other rebuilds the world and holds
time, answering *did some other subject move it*. The first runs before the
second, because the second's inference is only valid if the first came back
quiet.

### Bounded context

[**Stability**](./DOMAIN.md#stability)

### Implementation aliases

`again`, `alone`

## **Sweep**

### Meaning

A run that reads every subject twice. It is the denominator of every rate about
instability.

### Bounded context

[**Stability**](./DOMAIN.md#stability)

### Implementation aliases

`variance run --flakes`

## **Flake**

### Meaning

A subject that read differently twice, and did so again when asked again.
Before the second disagreement it is only a **suspect**.

### Bounded context

[**Stability**](./DOMAIN.md#stability)

## **Instability**

### Meaning

A disagreement between two readings that were supposed to agree. It is the
finding; capturing again until two agree destroys the only evidence there was.

### Bounded context

[**Stability**](./DOMAIN.md#stability)

## **Stabilization recipe**

### Meaning

The enumerable, named set of interventions applied to make a subject readable —
holding animations, hiding the caret, waiting for fonts, hashing assets,
blanking an unstable resource — folded into the identity of what it produced.

### Bounded context

[**Stability**](./DOMAIN.md#stability)

### Product appearance

Why a baseline read untouched and one read held still are two baselines rather
than a false change.

## **Arrival**

### Meaning

Whether a subject has finished appearing. Settled, pending and unobserved are
three states, and a pending subject is refused rather than captured.

### Bounded context

[**Stability**](./DOMAIN.md#stability)

### Implementation aliases

`awaitSuspense`, `suspenseRefusal`, `settle`

## **Reach**

### Meaning

Which subjects a change could have moved, derived from source rather than from
a build.

### Bounded context

[**Reach**](./DOMAIN.md#reach)

### Product appearance

The reason a run observes the subjects a change could have moved — and the
reason it observes every subject when it cannot tell.

## **Closure**

### Meaning

A hash over a node and everything it rests on, which proves sameness, beside
the reachability trail, which explains it. Cycles are condensed, never broken.

### Bounded context

[**Reach**](./DOMAIN.md#reach)

## **Seed**

### Meaning

Anything that enters a selection as more changed input, never as a second
opinion and never as a selection itself: the projects another build tool calls
affected, and the packages a lockfile comparison says the install moved. A seed
is walked from exactly as a changed file is.

### Bounded context

[**Reach**](./DOMAIN.md#reach)

## **Journey**

### Meaning

The path one execution of one **subject** took through the arrival regions of
instrumented source, in every process the execution touched. It is bounded by
its execution, never by a time window, and it is a path rather than a stack:
which regions were entered, never how deep. Where the execution crosses a
process, the journey is carried as one opaque identity so that what each
process reported is one path.

### Bounded context

[**Reach**](./DOMAIN.md#reach)

### Product appearance

The ground a run narrows on, and the answer to *which code did this subject
run*: where two **subjects'** paths parted, and where no path has ever gone. The
**subject**'s name never leaves the driver.

### Implementation aliases

`JourneyAccount`, `collectJourneys`, `stitchJourneys`; `JOURNEY_COOKIE` carries
the identity, `EXECUTION_GLOBAL` names the probe that records one step

## **Crossing**

### Meaning

One step of a **journey**: one observed entry into an instrumented region of
source, attributed to the test that entered it.

### Bounded context

[**Reach**](./DOMAIN.md#reach)

## **Announcement**

### Meaning

Three coordinates the software emits at the moment it decides something: a
location, a subject, an action. It says *when*, never *what*.

### Bounded context

[**Runtime narration**](./DOMAIN.md#runtime-narration)

### Product appearance

The reason a test can wait for a decision instead of guessing when it was made,
and the answer to an assertion a screen cannot make: a negative has no timing.

## **Watched run**

### Meaning

What a suite is saying, held in a process that outlives any one test, so a
suite in flight is something to look at rather than something to wait for.

### Bounded context

[**Runtime narration**](./DOMAIN.md#runtime-narration)

### Implementation aliases

`Observatory`, vantage

## **Scenario**

### Meaning

One witnessed path through named states: a precondition, authored acts, and the
state each act arrived at. An edge nobody witnessed is absent rather than
impossible.

### Bounded context

[**Runtime narration**](./DOMAIN.md#runtime-narration)

## **Act**

### Meaning

One authored transition in a **scenario**, labelled with a stable key so two
executions align on their common ordered prefix rather than on a plausible
pair.

### Bounded context

[**Runtime narration**](./DOMAIN.md#runtime-narration)

## **Attention**

### Meaning

Which elements a test addressed, in the order it addressed them, with their
authorship captured before the rendered tree moved.

### Bounded context

[**Runtime narration**](./DOMAIN.md#runtime-narration)

## **Presentation graph**

### Meaning

The relationships inside one live interface: what contains what, what separates
what, what aligns, what shares a baseline, what is a semantic peer.

### Bounded context

[**Presentation**](./DOMAIN.md#presentation)

## **Presentation finding**

### Meaning

A named relationship defect — a separation collapsing, an instance drifting
from its peers' grammar — which always names the node that owns the
relationship.

### Bounded context

[**Presentation**](./DOMAIN.md#presentation)

### Product appearance

Never a score, never a threshold, never a recommendation. Density and page
height are telemetry and can be correct at either extreme.

## **Hierarchy contract**

### Meaning

A product-owned, outside-in declaration of what a spacing relationship means:
owner boundary, leading to body, body peer, content internal. A design token is
implementation evidence and can never authorize a role.

### Bounded context

[**Presentation**](./DOMAIN.md#presentation)

## **Presentation signal**

### Meaning

The projection of a presentation reading into a general observation: effects
that were introduced, resolved or persisted. Consequence, technical impact and
**verdict** stay three separate axes, and storing the signal applies no policy.

### Bounded context

[**Presentation**](./DOMAIN.md#presentation)

### Product appearance

Absent means unobserved; empty means measured and clean.

## **Echo**

### Meaning

One rendering appearing in several subjects, so the differences it caused are
one review item.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication)

## **Divergence**

### Meaning

The same component with the same inputs rendering more than one way, at one
commit. It is a statement that a component's own inputs do not determine its
output. A candidate that an excluded input could explain is refused rather than
reported.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication)

## **Movement ladder**

### Meaning

Why a component moved, first rung that holds: edited, token, upstream,
contradicted, unexplained.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication)

### Product appearance

*Unexplained* is not a flake. It is the shortlist of subjects worth reading
twice.

## **Held**

### Meaning

The subjects where the same component with the same inputs did not move: the
control group. Empty means there was no control.

### Bounded context

[**Adjudication**](./DOMAIN.md#adjudication)

## **Approval**

### Meaning

One person's recorded decision to promote a **candidate**, with their name on
it. An append-only row; a reversal is a second row.

### Bounded context

[**Identity and retention**](./DOMAIN.md#identity-and-retention)

## **Capability**

### Meaning

What a caller is permitted to do, decided by the credential rather than claimed
by the caller. Writing evidence and deciding it are two capabilities and may
never be one value.

### Bounded context

[**Review**](./DOMAIN.md#review)

### Product appearance

A machine ingests; it does not decide. Anything holding the deciding
credential has no name, so a decision that needs a name needs an identity.

## **Build**

### Meaning

One run's evidence, uploaded to a review deployment for decision.

### Bounded context

[**Review**](./DOMAIN.md#review)

## **Decision**

### Meaning

One person's answer for one **subject**: promote this reading, or do not. A
subject with no uploaded **candidate** cannot be decided, and nothing is written
for a rejection.

### Bounded context

[**Review**](./DOMAIN.md#review)

### Product appearance

One answer per **cause** on the review surface, with the reviewer's name on it.

## **Changelog**

### Meaning

Why the **baseline**s are what they are: the regions, the commit, the intent and
the reviewer, frozen as a copy rather than joined, so the explanation lasts as
long as the baseline it explains.

### Bounded context

[**Identity and retention**](./DOMAIN.md#identity-and-retention)

### Product appearance

The commit message where baselines are commits, and the append-only row where
they are rows.

## **Churn**

### Meaning

How often a component has changed over a window.

### Bounded context

[**Identity and retention**](./DOMAIN.md#identity-and-retention)

## **Recurrence**

### Meaning

How often a subject has flaked over a window, with **sweeps** as the
denominator. A window with no sweep has no rate — absent, never zero.

### Bounded context

[**Identity and retention**](./DOMAIN.md#identity-and-retention)

## **Drift**

### Meaning

Movement over time in a value that was supposed to hold still — most often a
design token's resolved value, traced across the runs that resolved it.

### Bounded context

[**Identity and retention**](./DOMAIN.md#identity-and-retention)

## **Run report**

### Meaning

The versioned artifact a run leaves behind: every subject, its verdict, its
regions, its causes, what was not observed, what was absorbed, and what the run
held still.

### Bounded context

[**Report**](./DOMAIN.md#report)

### Product appearance

One format for a person, a change proposal and an agent. Its writer does not
own it and neither does any of its readers.

## **Not observed**

### Meaning

A subject the run did not look at, stated by name with the reason. It does not
gate — but a subject every shard excluded becomes a failure, because it is the
one thing sharding introduces that nothing else can see.

### Bounded context

[**Report**](./DOMAIN.md#report)
