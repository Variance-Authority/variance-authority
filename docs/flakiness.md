# Flakiness

Yes, visual regression is flaky. Anyone who says otherwise has either not run it
at scale or has quietly set a threshold large enough to hide it.

But "is it flaky" is the wrong question, and it is why the usual answers are
retries and tolerances — both of which trade a false alarm for a missed
regression at a rate nobody measures. The question worth asking about each cause
of variance is:

> **Who deals with this one, and what does it cost you?**

Four things can. The way the tool is built, so the cause never reaches anything
it reads. The environment key, which puts the two runs in different baselines
that are never compared to each other. A person, once, in a rule everybody then
lives with. Or nothing, and it lands on you — where some of it turns out to be a
real change wearing a flake costume.

The first three are worth a shorter word, and the rest of this page uses it: a
cause is **absorbed** when it happened and did not become your problem. Only the
last two answers are anybody's judgement call, and lumping all four under
"flaky" is what makes the whole category feel unmanageable.

## Four answers, and only two of them cost you anything

| Absorbed by | Meaning | Cost to you |
|---|---|---|
| **construction** | The change never reaches anything the run reads. No threshold, no config, nothing to tune. | none |
| **environment-key** | The two runs are different baselines, not a diff. They are never compared, so there is nothing to explain. | declare the environment honestly |
| **policy** | Both runs see it and both are right. Somebody has to decide. | one decision, once |
| **nothing** | It gets through. | fix the cause, or live with it |

A tolerance is the absence of all four. A tolerance large enough to swallow
rasterization noise is also large enough to swallow a small real change, and
nothing in the output tells you which one it just did.

## The causes, and who deals with each

The taxonomy of causes below is the industry's, and [Argos documents it
well](https://argos-ci.com/blog/screenshot-stabilization) — they are worth
reading. What differs here is the last column.

| Cause | Absorbed by | Notes |
|---|---|---|
| **Anti-aliasing, text smoothing** | construction | Glyph rasterization is not a property of the box tree, so it cannot reach a structure-and-style reading at all — there is no threshold to tune because there is nothing to threshold. It reaches the image, which is why the image is the last reading rather than the only one. |
| **Device pixel ratio, retina runners** | environment-key | `deviceScaleFactor` is in the key, so a 2× run and a 1× run are different raster baselines and never meet. It is also the *only* field the semantic key drops, because layout happens in CSS pixels and a 2× render lays out identically — one structure-and-style baseline is valid on a retina laptop, a 1× runner and a container alike. |
| **Different machine, GPU, driver** | environment-key | Renderer identity is not the machine. It is the engine and its version, the normalization ruleset, the computed-style allowlist, the viewport, the fonts by content hash, the resolved media and container conditions, the bytes behind every asset URL, and the digest of the stabilization recipe — and the semantic key is that same list with `deviceScaleFactor` removed. So your browser and CI compare on everything **except the pixels**, which is the one tier where the GPU, the driver and the flags you launched with actually live. That tier alone is partitioned by the full key, which is what makes a cross-machine *image* `incomparable` — one sentence, not a day of unattributable red. What a run captures and where its pixels are made are independent ([ADR-0044](context/adr/0044-capture-material-and-rendering-placement-are-independent.md)), so the fix for the last tier is to make it in one fixed place; see [ADR-0011](context/adr/0011-durable-and-ephemeral-retention.md), or use the ephemeral mode, where there is no second machine to be wrong about. |
| **Fonts substituted or not loaded** | environment-key, **and reported** | You are told, and the key is why telling you is necessary. Fonts are in the key by content hash, so a run that has `Inter` and a run that does not are different baselines — but that only saves you when the two runs *differ*. When neither machine has it, the key matches, the verdict is `unchanged`, and it is a true statement about a picture of the wrong typeface. So `variance doctor` renders a probe before you record anything, and a run that painted with a substitution puts the family and the subject count on the report: *the renderer lacked `Inter` in 12 subjects; those images are of a substituted font and their metrics are not the product's*. The probe says what it cannot tell you, too — a family that measures identically to the fallback is either absent or a metric-compatible substitute, and nothing on the page distinguishes those. |
| **Dates, clocks, dynamic content** | policy | Both runs move; both are right. The difference is what you mask: a pixel differ masks a *coordinate region*, which silences whatever else lands there and breaks the moment layout moves. We mask the *element* — or the *shape* of the difference, which follows a flake that moves — and report what each rule absorbed every run. [`ignores.md`](ignores.md). |
| **Page chrome, status bars, scrollbars** | construction (partly) | Observation is clipped to the subject element, so anything outside it cannot enter the image. Headless Chromium uses overlay scrollbars, so classic scrollbar reflow is outside what this CI environment observes. |
| **Animations mid-flight** | **construction** | There is a choice, and it decides which frame you review for the next year. `hold-animations` hands it to the browser at screenshot time, which fast-forwards a finite animation to completion — the state a user comes to rest on — and cancels an infinite one to its first frame. `pin-animations` does it in CSS, holding everything at frame one, so a fade-in is recorded at the moment it is invisible. Collection uses the CSS one because there is no screenshot there to hold. Neither writes `animation: none`, which would drop whatever layout the keyframes contribute. And because a transform caught in flight is a computed style value, the page is held still *before the subject is read*, not only before it is painted, with the recipe's digest in the key so an unstabilized baseline is `incomparable` rather than a diff ([`stabilization.md`](stabilization.md), [ADR-0029](context/adr/0029-a-page-is-held-still-before-it-is-read.md)). **What still gets through:** JS-driven animation, which no CSS reaches, and animated GIFs. |
| **Lazy loading, network latency** | **construction** | The cheapest answer is to not be waiting. A font that has not loaded cannot change which rules match or what they declare, and neither can an image that has not decoded — so the structure-and-style recipe is **empty**, and the tier that answers most subjects never waits for either. The wait is a cost of the tiers that paint, and it is skipped again there whenever the document is byte-identical to the one the baseline was painted from. Where a page does have to settle, the driver watches the wire rather than polling `document.images` — a poll misses anything appended while it is running and has no entry for a `background-image` at all, while the wire knows what has been asked for and not answered ([`stabilization.md`](stabilization.md)). A page that never stops fetching is reported, not failed. |
| **A framework still committing** | **nothing**, and readable | The wire settling is not the application finishing: a page whose every request has answered can be three commits from its final state, and a subject read in between is a real difference nobody made. The state of the art screenshots until two consecutive images agree — a raster per poll, and a timeout that names nothing. `@variance-authority/react` asks React instead: `awaitQuiet` returns the components still committing *by name*. **Absorbed by nothing** — the tap must be installed before `react-dom` loads, which a collector arriving at somebody else's page cannot guarantee, so it is an export you call rather than a wait the run performs ([`stabilization.md`](stabilization.md#the-framework-which-knows-when-it-has-finished)). |
| **A Suspense boundary that has not resolved** | **construction**, and **refused** | A subject read mid-arrival records a skeleton on a slow machine and its content on a fast one, with every band agreeing and both passes consistent — invisible to every other mechanism here, and to `storyRendered` and `readySelector` besides, because a component that suspends renders no markup to hang a marker on. Every collector waits on the boundary's own `memoizedState` before it reads, two clean readings deep so a waterfall cannot slip through the gap. A boundary still open at the timeout is **refused by name** rather than captured — the one escape hatch is declaring the subject a loading-state capture, which is then checked in the other direction too ([ADR-0037](context/adr/0037-a-subject-still-arriving-is-refused.md)). |
| **An asset whose bytes moved behind its URL** | **environment-key**, on both collectors and in both keys | A re-exported logo behind an unchanged URL is a change that no markup and no computed style can see. Where your bundler content-addresses, it already fixed this and there is nothing to pay: `logo.4f2a91.svg` **is** the identity, that string is in the markup the capture already hashes, and reading the bytes would record the same fact a second time — `hashAssets: false` is the right setting and costs you nothing. It is on by default because not every URL is built that way: a file served from `public/`, a CDN path, a font behind a stable name. For those the driver hashes the response, being the only party that sees the bytes, narrowed to the URLs the subject's own subtree references, and carries the digest into the **document** as well as the capture — the capture alone is not enough, because `settle` reads the document and would skip the render ([`stabilization.md`](stabilization.md#the-document-carries-them-too-which-is-what-settle-reads)). |
| **Animated GIFs** | **construction** | No CSS reaches a GIF, so `pin-animations` leaves a spinner spinning. The response is truncated to its first image block on the wire, before the browser decodes it — which needs no canvas and so has no cross-origin case, and returns the author's own bytes rather than a re-encode. |
| **Random seeds, unsorted data** | **nothing**, and reported | Absorbed by nothing — this is a real change and the fixture is the bug. What it does not arrive as is a component regression: a changed subject is read twice, and one that disagrees with itself is `unstable`, named with the component and the band. The run also says whether *anything in it* explains the movement, and lists the subjects where the same component with the same props held ([`composition.md`](composition.md)). See [below](#what-still-gets-through-and-how-it-is-found). |
| **Cross-origin stylesheets, third-party iframes** | **nothing** | A sheet we cannot read fingerprints as `unreadable` and compares equal, so a change inside one is invisible. Known blind spot, [ADR-0009](context/adr/0009-sessions-detect-instead-of-rinse.md). |
| **Reindented JSX inside a block** | **nothing** | Renders identically and moves our hash. Ours to fix; a pixel differ gets this one right. |

**Four** rows are absorbed by nothing, and they are the honest half of the table.

## What still gets through, and how it is found

Prevention is the base layer and it is on by default
([`stabilization.md`](stabilization.md)). What survives it is a residue, and a
residue is worth naming rather than tolerating.

A run that calls a subject `changed` is claiming something about a component, and
there are exactly three ways for that claim to be wrong: an earlier subject left
state behind, the page does not render the same thing twice, or somebody really
did edit something. All three arrive identically — *the pixels moved* — and they
need three different people to do three different things.

So a changed subject is collected a second time, and there are two second passes,
each varying exactly one thing:

| | world | time | answers | reported as |
|---|---|---|---|---|
| **`again`** | held | advanced | does this subject move on its own? | `unstable` |
| **`alone`** | rebuilt | same | did some *other* subject move this one? | `order-dependent` |

Neither is a retry: both outcomes of both are reported, and neither clears
anything. `again` runs first, and when it finds something `alone` is not asked —
its whole inference is *the clean reading differs from the shared one, therefore
the world moved it*, which is only evidence if two readings of one world would
have agreed. Asked in the other order, a page with a clock in it produces a
confident sentence about suite pollution and sends somebody to bisect a run order
that has nothing to do with it. Details in
[ADR-0030](context/adr/0030-two-second-passes-one-variable-each.md).

**What it names.** Not "this subject is flaky" — that is a page to read. The two
readings are two documents, and a document carries its component hashes, so the
answer is a component and a band:

```
[unstable] story:checkout--summary — Clock read differently (content)
```

`content` is data, `geometry` is layout that has not settled, `token` is a style
still being applied. That is the difference between a day and ten minutes, and it
is what a fix can be aimed at.

**What it costs.** One collection, and never a paint: two documents with equal
digests cannot paint differently, so the comparison is a digest comparison. It
runs only on subjects the run already called `changed`, inside the same
`alone.limit` budget, so a green run pays nothing.

**`accept` refuses an unstable subject**, for the reason it refuses order
dependence. The image on disk is one of two readings, chosen by a race, and
promoting it makes the coin flip the thing every later run is measured against.

### Nothing in this run explains it

Reading a subject twice answers *did it move on its own*. It does not answer
*should it have moved at all*, and that second question is answerable from
evidence the run already holds. Every component the run found to have moved is
walked down a ladder — an edited file, a moved token, an edited caller, a
contradiction elsewhere in the suite — and stops at the first rung that holds
([`composition.md`](composition.md#why-a-component-moved)). The last rung is
**unexplained**, and it is the one worth having:

```
unexplained (1) — no edited file, moved token, edited caller or contradiction in this
  run accounts for these; 1 in subjects already proven unstable

ds/chip--group · Chip (content)
  no file, token or ancestor explains it, and the same component with the same props
    held in 4 other place(s) in this run
  [flake] the subject also failed to read the same way twice in this run, so both
    halves of the sentence are present
  held in 4 other place(s): page/all, page/active, page/completed, page/one
```

**Two names, and they are not two confidence levels in one claim.** `flake` is
an unexplained movement in a subject that *also* failed to read the same way
twice — both halves of the sentence, established by two different instruments,
in one run. `suspect` is an unexplained movement in a subject nobody has read
twice; it is a shortlist entry and the report says so in those words.

Both are statements about a subject. Where the two readings carry component
holdings, [`partingOf`](parting.md) makes the same accusation about a
**boundary**: the component whose props, contexts and hook cells were all read,
all agreed, and whose output moved anyway. That is the narrower claim, and it is
available only to a run that asked what the components were holding — which is
why an unread boundary is a slice of its own rather than a quiet pass.
Narrower again is a *region* of that component's source, which neither reading
reaches and which is answered
[from what the run executed](#which-part-of-the-module-they-took-differently).

**The `held` list is what makes any of it evidence.** Those are the subjects
where the same component, with the same props, did not move — the stable states
to refer to, and the suite supplies them for free, because they are the other
sites of the same rendering. An empty `held` list *weakens* a finding rather
than strengthening it, which is why it is a list rather than a flag.

It costs no collection, no browser and no image: it is a fold over digests the
run already produced. What it needs is [`--since`](selecting.md), because the
top two rungs are unreachable without a change set — and a run that did not ask
says so beside every unexplained movement instead of accusing anybody.

### Which part of the module they took differently

The ladder narrows a movement to a component, and where the two readings carry
holdings [`partingOf`](parting.md) narrows it to a boundary. Neither says *where
inside it*, and for the flake that only appears once a handler has run, the
region is the fix.

Neither reading can, because neither was inside the module while it ran. The
execution journal was: a preview built with `testSelectionProbes()` records which
regions of which modules each subject crossed while it was painted. Two subjects
that render one module and enter different regions of it have **parted**, and a
parting is a place:

```bash
variance journeys
```

```
app/src/components/CartCard.tsx  3 observers
  parted     handler CartCard/onClick  51-58
    entered  story:cart-card--removing
    missed   story:cart-card--item, story:cart-card--verbose
  unentered  branch CartCard/empty  62-64

pool: 3 observations the journal recorded whole, out of 3 subjects the report names
note: recorded at 4f2a1c9d0b73
```

The pool per module is whoever entered a region **with source of its own**,
which is not whoever loaded the file — a module root is crossed on import, so
every subject in a bundle crosses every module in it, and counting those would
report one pool of everybody for every module in the app.

**Nothing here is a verdict.** It exits `0` whatever it finds, because every
suite with two stories per component has partings; a parting is where to look
once something else has already said something moved.

**The pool is most of the finding.** The journal accumulates across runs, so
read whole it answers about the record rather than about this run: a story
deleted two commits ago is still a party to every parting it was recorded in. So
the pool is the subjects the report names, `--all` asks for the record on
purpose, and a checkout with no report to read gets the record *with the
sentence saying that is what it got* — a pool nobody chose must never print as
one somebody did. Three other ways a pool is not what it looks like are each
named rather than left to be inferred:

| What happened | Why it is not silence |
|---|---|
| An observation was recorded incomplete | Dropped from the pool rather than counted as having missed — a recording that stopped early proves no absence — and counted in a note, because a pool of two that should have been three reads as agreement |
| The journal holds no row for a subject the report names | The last recording did not paint it, or it did not exist then. Every finding is silent about it for that reason and no other |
| Fewer than two observations survive | A parting is a disagreement between two observers of one module, so a pool that cannot hold two has not found nothing — it has not been able to look |

**`unentered` is the weaker sibling finding**: regions with source of their own
that *no* observer in the pool entered. Not "these two renders disagree" but
"this run never went here at all", which is the same absence
[`selecting.md`](selecting.md#what-this-does-not-reach) cannot select on — and
naming where it is does not close it.

### Stability is required inside the boundary, not outside it

A subject that declared what it asserts on has already answered for movement
outside it. A route declared `layout` ([`ignores.md`](ignores.md),
[`comparison.md`](comparison.md)) has said in the config that it does not assert
on what the page is painted with — so a clock ticking inside it is a fact about
the page rather than a defect in it:

```
not asserted on: 1 subject(s) read differently between two readings,
  entirely in bands their declared level does not assert on. Working as declared, and
  listed because a declaration nobody re-reads is how a suite stops watching something:
    route/home — content, absorbed by `routes` (asserts on layout)
```

That line is not a finding. It does not gate, `accept` does not refuse it, and no
agent is told to go fix it. The alternative was a check that made **every**
route-level test red for exactly the movement its level was written to ignore.

It is still counted and still names the rule, which is the same rule `ignored`
follows for pixels — one level up and about *kinds* rather than *places*. A
declaration nobody re-reads is how a suite quietly stops watching something, and
the rule's name is what makes that auditable a year later.

The decision uses `absorbsEntirely`, the same predicate the verdict uses, so the
two cannot drift: **entirely**, so a subject where any moved band *is* asserted on
is reported in full, including the bands that would have been absorbed. `strict`
absorbs nothing and is how the exception inside a relaxed group is spelled.

**The sweep, for the other half of the question.** The rule above fires only on a
subject the run already called `changed`, which means the first time a flake is
seen it has already cost a red build. `variance run --flakes` reads *every*
subject twice instead, so a subject that agrees with its baseline and disagrees
with itself is found one run earlier — and that is unreachable from a verdict,
because a green suite settles on its digests and never builds a comparison at
all. It costs one collection per subject and no render, which is the shape that
pays for itself nightly rather than on every pull request, and it exits `1` even
when every verdict is green.

**The sweep reads in plan order.** The shortlist an unexplained movement
produces is sorted by how much control the suite has over each entry, and
nothing points the sweep at it. A subject with four held siblings and a subject
with none get the same second reading in the order the plan emitted them.

**Two readings is a floor, not a ceiling.** A subject that reads differently one
time in fifty passes this forty-nine runs out of fifty, and an absent finding
means *this run's two readings agreed* — never *this subject is stable*. The
report says so in those words. The second instrument is
[recurrence over a window](#has-this-happened-before), which needs a record and
therefore a service. The third is the suite itself, at this one commit: the same
component with the same props, held in subjects that did not move
([`composition.md`](composition.md)), which needs no record and no second run
because the control group was already collected. Raster-level nondeterminism is
invisible to all three for the same reason the first is cheap — it does not move
a document digest.

### Has this happened before?

The question two readings cannot answer, and the one that decides who fixes it.
*Unstable in 6 of 20* says the fixture is bad; *6 times, and the last 9 sweeps
were clean* says somebody already fixed it, and rewriting that fix is a day spent
re-solving a solved problem.

A run records what it saw when a [history service](history.md) is configured,
then asks the record about every subject it just called unstable. The answer
travels in the report, so the summary, the pull-request comment and an agent all
read one sentence:

```
UNSTABLE: 1 subject(s) were read twice, seconds apart …
    story:checkout--summary — Clock (content)
      read differently in 6 run(s), 50% of the 12 sweep(s) that asked, and the most recent
      sweep still saw it
      — recurring, and the most recent sweep still saw it: the fixture is the bug
```

**The denominator is sweeps, not runs**, and that is the whole arithmetic. An
ordinary run reads a subject twice only after the comparison called it `changed`,
so a subject that was green in eighteen runs was never *asked* whether it agrees
with itself. Dividing by runs would report a flake that fires every single time
anybody looks as firing one time in ten. `variance run --flakes` sweeps, a sweep
is recorded as one, and a window containing no sweep has **no rate at all** —
absent, never zero ([ADR-0032](context/adr/0032-a-flake-rate-divides-by-the-runs-that-asked.md)).

**Recency is counted in sweeps too.** "Nine sweeps have not seen it since" is a
statement about examinations; "three weeks" is a statement about the calendar, and
a suite that stopped running would look increasingly healthy the longer nobody
looked at it.

**No record answering is said out loud.** A subject with no history entry prints
*that is silence, not a first occurrence* — because the reader most wants the
opposite to be true, and nothing in a single run supports it.

What it takes to have one: a `history` block in the config pointing at a service
you run, and a run that can name itself — `--run` and `--commit`, or the pair the
CI you are already inside exports. Without an identity nothing is recorded and the
run says so, because a history that quietly stops growing is worse than none.

### The class of defect a second reading reaches

The instability it catches need not be in the page. It can be in the observer,
and that is the case no assertion about a verdict can reach — because the verdict
stays right.

Browser attribute materialization can otherwise make the same element serialize
in a different order after it has been read once. The observer materializes those
attributes before it stamps provenance, so two readings of one stable subject
produce one document digest. A disagreement is reported as instability even when
the pixels and verdict still agree.

That protects render reuse as well as correctness. `settle` skips a render only
when the document digest repeatably describes the same subject; observer-induced
digest movement therefore cannot silently disable the cheap tier for later runs.

### No two are alike, so the answer is a place

The word invites a class response: retry it three times, quarantine the name,
widen the threshold until it stops. Each of those treats *flaky* as a property
the test has. It is not. It is one specific thing that happened once — a clock,
a sheet that escaped its story, an effect that ran twice, a fixture that
shuffles — and the next one is a different specific thing. A retry budget tuned
to the last one absorbs the next one in silence, which is how a suite ends up
with a pass rate nobody believes.

So nothing here classifies. Every instrument narrows, and each rung names a
smaller place than the one above it:

| Narrowed to | Named by | What it asks of you |
|---|---|---|
| **a component and a band** — `Clock (content)` | the second reading, above | nothing: it runs on subjects the run already called `changed` |
| **a boundary** — the component whose props, contexts and hook cells were all read, all agreed, and whose output moved anyway | [`partingOf`](parting.md) | a run that asked what the components were holding |
| **an input** — an ancestor's `color`, a context, a hook cell, or nothing readable at all | the divergence's parting lines ([`composition.md`](composition.md)) | two renderings of one input inside one run, which the suite is usually already producing |
| **an Act** — the step at which two executions of one journey stopped agreeing | scenario execution divergence ([`scenarios.md`](scenarios.md)) | a recorded scenario. It writes no verdict and no baseline; it is evidence to read |
| **an element** — the query the test issued, what it resolved to, and the component that rendered it | [Eyes](eyes.md) | installing it beside the React Testing Library or Playwright the suite already has |
| **a region of source** — the lines some observers of a module entered and others did not | `journeyDivergences` in [`@variance-authority/sense`](../packages/sense) | execution recording, and an API call over the coverage it produced |

Read down until something names a thing you can change, then stop. These are not
confidence levels on one claim; they are different claims, each from an
instrument the rung above it cannot reach. *`Price` renders two ways from one
props digest* states a contradiction and leaves you to go find it. *Three
subjects mount `CartCard`, one of them clicked Remove, and this `onClick` body is
a region the other two have never been inside* names the region — and nothing
static says it, because it is the same file, the same import graph and the same
props.

After that the fix is ordinary: inject the clock, scope the sheet, seed the
fixture. The finding does not come back, because nothing is holding it down. A
retry deletes the report of a cause; a location deletes the cause.

## Test order and shared state

The other half of flakiness is not the camera, it is the suite: subject B fails
only when subject A ran first. The usual fix is to rebuild the world between
subjects, which prevents the problem by paying for it on every subject forever.

We do not rinse. `@variance-authority/session` photographs shared state around
each subject and derives what each subject *read* from its own capture, so
pollution becomes a read-write conflict with a named writer:

```
[confirmed] story:card
  cause:    story:toolbar (rendered by Button, Toolbar)
  via:      sheet:<style:0>
  evidence: re-running `story:card` in the same session produced a different
            render hash with no code change; `story:toolbar` wrote
            `sheet:<style:0>`, which this subject matched via `.card`
  fix:      make `story:toolbar` clean up `sheet:<style:0>`, or scope it so it
            cannot reach `story:card`
```

Measured at **3–4× faster** than rinsing, with the probe costing **~2%** of
session time. The [session cost measurement](../packages/session/src/cost.measure.ts)
re-measures it on every run and asserts only that it is materially cheaper,
because the multiple moves with the machine and a tight bound would fail on a
loaded CI box. Details in
[ADR-0009](context/adr/0009-sessions-detect-instead-of-rinse.md).

**A `variance run` does not do that.** It calls the adopter's collector once per
subject, and the mount a probe would bracket happens inside that call, in a world
the collector owns. What a run does instead is cheaper and more general:

> **A subject whose change is gone when it is collected alone was moved by the
> session, not by an edit.**

Only subjects that changed are re-collected, so a green run pays nothing; the
shared render is already cached, so a red one pays a single render per subject,
capped by `alone.limit`. The result is reported as `order-dependent` rather than
`changed`, and **`accept` refuses it** — promoting it would make the leak the
baseline, and the subject would compare clean for as long as the leak survived.
The clean world is the collector's to build, like the shared one: a fourth method
on [the contract](surface.md#1-the-three-things-you-write), optional because a
collector handed somebody else's live page has no world of its own to rebuild.
Holding one page open across a run is not that case — a preview can be opened
twice — and both shipped collectors build the second world from the same recipe
as the first, on the same server, so nothing but isolation differs.

This catches the case the probe's own confirmation tier cannot. `verify()`
re-runs a subject **in the same session**: it varies time and holds the world
fixed, so a leak that happens *every* time never moves the hash and reports as
nothing. That deterministic kind is the one that becomes a false regression
rather than a flake.

**A run identifies the affected component, not the writer of an order leak.** A
probe sees stylesheets, custom properties, attributes and stray body nodes; the
couplings that bite live in module scope — a singleton store, a cached client, a
mocked clock — and touch no DOM at all. With no runtime stack connecting the
mutation to its writer, the outcome resolves to a node, a component and source
attribution. Locating the writer requires bisection over run order.

## Recurring diff fingerprints

Variance Authority treats an unstable hash as a finding with a cause, not noise
to suppress. Diff-shape grouping can correlate recurring observations, but it
does not license automatic acceptance: the same suppression can hide a later
regression in the same region. [The product comparison](comparison.md) covers
the different acceptance trade-offs.

[`mask-fingerprint`](https://github.com/argos-ci/mask-fingerprint) derives a key
by dilating the mask of differing pixels, cropping it to its bounding box,
reducing it to a density grid and hashing the result. Variance Authority uses
that method for shape-scoped ignore rules: tolerant equality in pixel space,
not approximate similarity. The derived key groups observations without
deciding whether they are acceptable.

That is the same move as
[differencing two renders that vary in one prop](composition.md) to learn what
that prop controls, and the same move as deriving a component's `wiring` from the
fiber to separate two byte-identical documents
([ADR-0036](context/adr/0036-the-fiber-is-a-band-and-a-finding.md)). What each
derivation *can* license is decided by its substrate, not by its cleverness: a
fingerprint is derived from pixels, so it is a key in pixel space — change the
viewport and it is a different key for the same defect, move the component down
the page and it is a different key, and two unrelated components whose diffs are
the same blob are one key. Our recurrence key is derived from a component and a
band, so it survives all three and carries a `file:line`. Neither is recoverable
from the other, and the direction matters: **you cannot get from the shape of the
pixels that moved back to the component that moved them.**

The two instruments differ in what they need and in what they can say. Counting
fingerprints needs a *window* — several runs, and a store to keep them in — and
answers with a probability. Reading the subject twice needs one run and answers
with a component and a band, because the evidence is two documents rather than
two images. The cost of ours is that it only ever fires on a subject the run
already called `changed`; the cost of theirs is that the first several
occurrences are red builds.

We run **both halves**, and the difference from their design is in the last step
only. We count occurrences over a window, keyed on the
component and band that moved rather than on a diff fingerprint, and we report
the count — [we do not act on it](#has-this-happened-before). Nothing is
auto-ignored at any threshold: the count tells a reader whether to expect a long
afternoon or a fix that already landed, and the suppression decision stays a
declaration somebody writes down ([`ignores.md`](ignores.md)).

**A third axis: the rest of the suite at the same commit.**
Both instruments above are longitudinal — the same subject, read again or looked
up in a window. A visual-regression suite is also a set of examples built from
shared components, so the same component with the same props is usually
rendering somewhere else *right now*, and whether it moved there is a control
the run can read for free ([`composition.md`](composition.md)). That is where
*no related change* stops being an assumption: an unexplained movement beside
four places the component held is a different claim from an unexplained movement
with nothing to compare against, and the report distinguishes them rather than
calling both flaky. What it does **not** do is decide — an unexplained movement
is still not a flake until something has read the subject twice.

The honest cost of our bet: suspicion over-reports. A coupling can exist and
never bite, so the read-write pass alone produces findings that a confirmation
run then clears — and a project that never calls `verify()` gets suspicion only.
Every finding carries a `confidence` field for exactly this reason.

## What none of this establishes

Every instability probe we have run **simulates** its cause — a smoothing mode
instead of a different GPU driver, a second browser context instead of a second
runner — because varying the machine is not available from inside a test. Except
where a row says otherwise, every number comes from one Mac and one
Chromium, which bounds what they prove.

---

**Further.** [`instruments.md`](instruments.md) — the whole set, including the
flake instruments as one table of what each varies and what each holds.

**Sources.** [Argos: stabilize screenshots](https://argos-ci.com/blog/screenshot-stabilization) ·
[Argos: flaky test detection](https://argos-ci.com/docs/learn/reliability-and-flakiness/flaky-test-detection.md) ·
our own measurements: [journal 0012](context/journal/0012-instability.md), [ADR-0009](context/adr/0009-sessions-detect-instead-of-rinse.md), [ADR-0011](context/adr/0011-durable-and-ephemeral-retention.md), [ADR-0030](context/adr/0030-two-second-passes-one-variable-each.md)
