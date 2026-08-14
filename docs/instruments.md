# Instruments

Finding that something moved is the easy third of the job. The other two are
deciding whether the movement is real, and saying what caused it — and in most
of this category they are the reader's problem, handed over as a red rectangle.

Three stages, and they are not equally expensive here:

| stage | the question | what it costs |
|---|---|---|
| **detect** | did anything move? | almost nothing — a subject whose document digest equals the one its baseline was painted from is settled without a render |
| **adjudicate** | is the movement real, and is it *this* subject's? | one collection per changed subject, and never a paint |
| **attribute** | what caused it, and where is it written? | a fold over digests the run already produced |

That profile is inverted from the usual one, and it is the whole design. Because
detection is nearly free, the budget goes into the two stages that decide whether
anybody's afternoon is spent well — which is also why reading every subject twice
is affordable at all.

## Every instrument varies one thing

There is one move underneath all of them: **hold everything still, vary exactly
one thing, and read a representation cheap enough to read again.** A semantic
snapshot is text and costs about 7.5 ms warm against roughly 65 ms to paint
([ADR-0010](context/adr/0010-tier-specific-environment-keys.md)), which is what makes
"read it again" a design option rather than a budget line.

| instrument | varies | holds | names |
|---|---|---|---|
| **baseline comparison** | the revision | the subject, the world | a component, a band, a `file:line` |
| **[`again`](flakiness.md#what-still-gets-through-and-how-it-is-found)** | time | the world | `unstable`, with the component and band that moved |
| **[`alone`](flakiness.md#test-order-and-shared-state)** | the world | time | `order-dependent`, and `accept` refuses it |
| **[composition](composition.md)** | the subject | the revision | echoes, divergences, and why each component moved |
| **[history](history.md)** | the run | the subject | recurrence, sweeps-since, and [drift](history.md#how-far-a-token-has-drifted) |
| **[the session probe](../packages/session)** | subject order | the world | the *writer*, by subject and by what it wrote |
| **[`trail`](../packages/core)** | the edit step | the subject | since-start, put-back, and going in circles |
| **the engine** | the observer | everything | which tier can decide, and which cannot see it |

Each row is a controlled experiment, and the discipline of one variable is what
lets the answer be a sentence instead of a probability. It is also why the rows
compose: `again` and `alone` vary opposite things, so running both on one changed
subject partitions three causes that arrive identically.

**Where a row is reached from is a fact about it rather than a detail of
packaging.** The record behind recurrence, sweeps-since and drift is a service
the operator runs, and a run reaches it exactly when the config names an endpoint
and a token and the run can name itself
([`history.md`](history.md#turning-it-on)); with none of those named it computes
nothing for the record, rather than hashing three hundred snapshots to hand them
to something that discards them. The session probe rides on a standing
world — `createSession` is the runner, and the probe brackets every mount that
arrives through `session.run` — so naming the *writer* means owning the loop; a
run hands each subject to the adopter's collector instead and asks `alone` of a
subject it called `changed`, which establishes at most that something else in
the suite moved this one, and never which thing. `trail` is the same division: a
value in `core/judge` and pure functions over it, whose holder is whoever runs
the loop, for as long as they hold it.

### The pair that decides whether a change is real

A run calling a subject `changed` is claiming something about a component, and
there are exactly three ways for that claim to be wrong: an earlier subject left
state behind, the page does not render the same thing twice, or somebody really
did edit something. All three arrive as *the pixels moved*, and they need three
different people.

| | world | time | answers | reported as |
|---|---|---|---|---|
| **`again`** | held | advanced | does this subject move on its own? | `unstable` |
| **`alone`** | rebuilt | same | did some *other* subject move this one? | `order-dependent` |

**The order is load-bearing, not an optimization.** `again` runs first, and when
it finds something `alone` is not asked — its whole inference is *the clean
reading differs from the shared one, therefore the world moved it*, which is only
evidence if two readings of one world would have agreed. Asked the other way
round, a page with a clock in it produces a confident sentence about suite
pollution and sends somebody to bisect a run order that has nothing to do with
it ([ADR-0030](context/adr/0030-two-second-passes-one-variable-each.md)).

Neither is a retry. Both outcomes of both are reported, and `accept` refuses the
first two — promoting a reading chosen by a race makes the coin flip the thing
every later run is measured against.

### The control group was already collected

The instruments above are longitudinal: the same subject, read again or looked up
in a window. A suite is also a set of examples built from shared components, so
the same component with the same props is usually rendering somewhere else *right
now*, and whether it moved there costs nothing to read
([`composition.md`](composition.md)).

That is what turns *nothing explains this* from a shrug into a finding. An
unexplained movement beside four subjects where the component **held** is a
different claim from one with nothing to compare against, and the report keeps
them apart rather than calling both flaky.

## What has no baseline in it at all

The stage-one story above is about comparison. A whole class of defect is
invisible to every comparison, because it compares equal to itself on every run
forever — and these fire on a first run, on a green run, and on a suite with no
baselines:

| what it finds | why no comparison reaches it |
|---|---|
| **[inspection findings](../packages/core)** — a control with no accessible name, a string nobody translated | it has always been wrong, so it never *changes* |
| **[remounts](framework.md#remounts-what-the-document-cannot-show-you)** — an instance destroyed and rebuilt rather than updated | identical `outerHTML`, identical `rendering`, identical `wiring`. What differs is the state, the focus and what the user typed |
| **[wiring](framework.md#wiring-a-sixth-band)** — a lost `memo`, an unkeyed list, a context subscription | two byte-identical documents that are two different components |
| **[a Suspense boundary still open](stabilization.md#pendingsuspense--the-boundary-that-has-not-arrived-by-name)** | a component that suspends renders no markup for a marker to attach to, and both arms agree on a skeleton |
| **[asset bytes behind an unchanged URL](stabilization.md#every-asset-is-hashed-into-the-environment-key)** | no markup and no computed style can see a re-exported logo |
| **[a substituted font](stabilization.md#what-runs-and-what-it-absorbs)** | two runs of the substitution compare `unchanged` — true, and worthless |

The last row of that argument is the one worth stating separately, because it is
about the instrument rather than the page: **reading a subject twice catches
instability in the observer, which no assertion about a verdict can reach.** The
worked case is a Blink attribute-order effect that moved a document digest while
leaving the verdict entirely correct, silently switching off the cheap tier
depending on the collection history of the run that recorded the baseline
([`flakiness.md`](flakiness.md#the-class-of-defect-a-second-reading-reaches)).

## One vocabulary across all three stages

The stages hand each other the same three things — a **component**, a **band**,
and a **`file:line`** — which is what makes the chain readable end to end rather
than three tools stapled together.

- A verdict resolves to a component and a band, because a document carries its
  component hashes.
- A second reading that disagrees resolves to the same pair, so
  `Clock (content)` is what a fix is aimed at rather than *this subject is flaky*.
- A recurrence key is that pair, which is why it survives a viewport change and a
  component moving down the page, and why it carries a location. A key derived
  from pixels cannot: **you cannot get from the shape of the pixels that moved
  back to the component that moved them.**
- The location is the line the element is *written* on, resolved on demand
  through the source map a development server already emits — no plugin, no
  `jsxImportSource`, no build change of any kind
  ([`comparison.md`](comparison.md#31-a-diff-that-names-a-component-and-a-file)).

## Where each claim is measured

| claim | where |
|---|---|
| A diff names a cause, a place and a file, against a real incumbent's runner | `cases/incumbent-case` — **6 hit, 1 false alarm, 1 deferral** against 3 hit, 3 miss |
| Both tiers agree on the dimensions both can observe | 38/38 under jsdom, 39/39 under Chromium, on `examples/kitchen-sink` |
| A component's hash covers its own nodes, so one edit moves one component | `examples/todomvc/src/closure.test.tsx` |
| The suite shares renderings, and which examples watch the same bytes | `examples/todomvc/src/composition.test.tsx` — 26 shared renderings, 0 divergences |
| Wiring separates two byte-identical documents | `examples/todomvc/src/fiber.test.tsx` |
| A remount is invisible to every band | `packages/react/src/identity.test.tsx` — `1 of 1` against `0 of 1` |
| Detecting cross-pollution beats rinsing it away | 3.4× faster, probe overhead ~2% of session time ([ADR-0009](context/adr/0009-sessions-detect-instead-of-rinse.md)) |
| Which bands a single prop reaches | `examples/todomvc/src/contrast.test.tsx` — seven props, five distinct sets |

## What none of this establishes

**One machine and one Chromium.** Every timing and every instability probe comes
from one M-series Mac, and every probe *simulates* its cause — a smoothing mode
rather than a different GPU driver, a second browser context rather than a second
runner. Varying the machine is not available from inside a test.

**One corpus, written by the people who wrote the implementation.** Ground truth
was declared before the pipeline existed, which is worth something, and no
third-party component library has been run through any part of this.

**Two readings are a floor and never a ceiling.** A subject that reads
differently one time in fifty passes this forty-nine runs out of fifty, and an
absent finding means *this run's two readings agreed* — never *this subject is
stable*.

**Four causes of variance are absorbed by nothing**, and they are named in
[`flakiness.md`](flakiness.md#the-causes-and-what-absorbs-each) rather than left
for a reader to discover.

---

**Further.** [`flakiness.md`](flakiness.md) — the position on variance, and the
taxonomy of what absorbs each cause ·
[`composition.md`](composition.md) — the suite compared to itself ·
[`framework.md`](framework.md) — what the fiber answers that the document cannot ·
[`history.md`](history.md) — the questions that need a record ·
[`stabilization.md`](stabilization.md) — prevention, which runs before any of this ·
[`gates.md`](gates.md) — whether that adds up to a replacement for what you pay for
