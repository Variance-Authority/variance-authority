# Instruments

Finding that something moved is the easy third of the job. The other two are
deciding whether the difference is real, and saying what caused it — and in most
of this category they are the reader's problem, handed over as a red rectangle.

Three stages, and they are not equally expensive here:

| stage          | the question                                      | what it costs                                                                                                             |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **detect**     | did anything move?                                | almost nothing — a subject whose document digest equals the one its baseline was painted from is settled without a render |
| **adjudicate** | is the difference real, and is it _this_ subject's? | one collection per changed subject, and never a paint                                                                   |
| **attribute**  | what caused it, and where is it written?          | a fold over digests the run already produced                                                                              |

That profile is inverted from the usual one, and it is the whole design. Because
detection is nearly free, the budget goes into the two stages that decide whether
anybody's afternoon is spent well — which is also why reading every subject twice
is affordable at all.

## Every instrument varies one thing

There is one move underneath all of them: **hold everything still, vary exactly
one thing, and read a representation cheap enough to read again.** A semantic
snapshot is text, and painting the same page in the same process costs
**roughly eighteen times as much** — 3.0 ms against 54.0 ms on the machine that
last ran `yarn workspace @variance-authority/example-todomvc pixel`, 3.4 against
65.4 on an earlier one. The milliseconds are machine-bound and the ratio is not,
and it is the ratio that makes "read it again" a design option, not a
budget line.

| instrument                                                              | varies                  | holds                  | names                                                                         |
| ----------------------------------------------------------------------- | ----------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| **baseline comparison**                                                 | the revision            | the subject, the world | a component, a band, a `file:line`                                            |
| **[`again`](flakiness.md#what-still-gets-through-and-how-it-is-found)** | time                    | the world              | `unstable`, with the component and band that changed                          |
| **[`alone`](flakiness.md#test-order-and-shared-state)**                 | the world               | time                   | `order-dependent`, and `accept` refuses it                                    |
| **[composition](composition.md)**                                       | the subject             | the revision           | echoes, divergences, and why each component moved                             |
| **[variation](variations.md)**                                          | the subject, on purpose | the revision           | what a declared variant changes, and whether that changed                     |
| **[history](history.md)**                                               | the run                 | the subject            | recurrence, sweeps-since, and [drift](history.md#how-far-a-token-has-drifted) |
| **the engine**                                                          | the observer            | everything             | which tier can decide, and which cannot see it                                |

Each row is a controlled experiment, and the discipline of one variable is what
lets the answer be a sentence instead of a probability. It is also why the rows
compose: `again` and `alone` vary opposite things, so running both on one changed
subject partitions three causes that arrive identically.

History is the one instrument whose evidence crosses runs. It contributes
recurrence and drift only when configuration names an endpoint and token and
the run has an identity ([`history.md`](history.md#turning-it-on)); otherwise
those fields are absent.

### The pair that decides whether a change is real

A run calling a subject `changed` is claiming something about a component, and
there are exactly three ways for that claim to be wrong: an earlier subject left
state behind, the page does not render the same thing twice, or somebody really
did edit something. All three arrive as _the pixels moved_, and they need three
different people.

|             | world   | time     | answers                                 | reported as       |
| ----------- | ------- | -------- | --------------------------------------- | ----------------- |
| **`again`** | held    | advanced | does this subject drift on its own?      | `unstable`       |
| **`alone`** | rebuilt | same     | did some _other_ subject change this one? | `order-dependent` |

**The order is load-bearing, not an optimization.** `again` runs first, and when
it finds something `alone` is not asked — its whole inference is _the clean
reading differs from the shared one, therefore the world changed it_, which is only
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
the same component with the same props is usually rendering somewhere else _right
now_, and whether it changed there costs nothing to read
([`composition.md`](composition.md)).

That is what turns _nothing explains this_ from a shrug into a finding. An
unexplained difference beside four subjects where the component **held** is a
different claim from one with nothing to compare against, and the report keeps
them apart instead of calling both flaky.

## What has no baseline in it at all

The stage-one story above is about comparison. A whole class of defect is
invisible to every comparison, because it compares equal to itself on every run
forever — and these fire on a first run, on a green run, and on a suite with no
baselines:

| what it finds                                                                                                                   | why no comparison reaches it                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **[inspection findings](../packages/core)** — a control with no accessible name, a string nobody translated                     | it has always been wrong, so it never _changes_                                                                                |
| **[remounts](framework.md#remounts-what-the-document-cannot-show-you)** — an instance destroyed and rebuilt rather than updated | identical `outerHTML`, identical `rendering`, identical `wiring`. What differs is the state, the focus and what the user typed |
| **[wiring](framework.md#wiring-a-sixth-digest)** — a lost `memo`, an unkeyed list, a context subscription                       | two byte-identical documents that are two different components                                                                 |
| **[a Suspense boundary still open](stabilization.md#pendingsuspense--the-boundary-that-has-not-arrived-by-name)**               | a component that suspends renders no markup for a marker to attach to, and both runs agree on a skeleton                       |
| **[asset bytes behind an unchanged URL](stabilization.md#a-url-your-build-did-not-name-is-hashed-on-the-wire)**                 | no markup and no computed style can see a re-exported logo                                                                     |
| **[a substituted font](stabilization.md#what-runs-and-what-it-absorbs)**                                                        | two runs of the substitution compare `unchanged` — true, and worthless                                                         |

The last row of that table is the one worth stating separately, because it is
about the instrument, not the page: **reading a subject twice catches
instability in the observer, which no assertion about a verdict can reach.** The
worked case is a Blink attribute-order effect that changed a document digest while
leaving the verdict entirely correct. Left in place, it can turn the cheap tier off
for later runs, and whether it does depends on the collection history of the run
that recorded the baseline
([`flakiness.md`](flakiness.md#the-class-of-defect-a-second-reading-reaches)).

### Four instruments that never open one

Those rows are about defects a comparison cannot reach. These are readings that
do not attempt one: each answers _what happened in this run_, which is a
different question from _is this different from what we agreed_, a shift set out
in [ask a question the test did not ask](observability.md). Each is installable
on its own.

| instrument                                                | the question                                                  | what it needs                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| **[Eyes](eyes.md)**                                       | which elements did this test address, and who rendered them?  | the React Testing Library or Playwright already in the suite          |
| **[Vantage](vantage.md)**                                 | what is this run saying, while it is still saying it?         | one environment variable, and a process to watch from                 |
| **[scenarios](scenarios.md)**                             | at which Act did two executions stop agreeing?                | a journey named in the test that already walks it                     |
| **[divergence](composition.md#one-input-two-renderings)** | one props digest, more than one rendering — from which input? | two renderings in one run, which a suite is usually already producing |

None of them writes a baseline, an approval, a history row or an exit code.

## One vocabulary across all three stages

The stages hand each other the same three things — a **component**, a **band**,
and a **`file:line`** — which is what makes the chain readable end to end rather
than three tools stapled together.

- A verdict resolves to a component and a band, because a document carries its
  component hashes.
- A second reading that disagrees resolves to the same pair, so
  `Clock (content)` is what a fix is aimed at rather than _this subject is flaky_.
- A recurrence key is that pair, which is why it survives a viewport change and a
  component moving down the page, and why it carries a location. A key derived
  from pixels cannot: **you cannot get from the shape of the pixels that moved
  back to the component that moved them.**
- The location is the line the element is _written_ on, resolved on demand
  through the source map a development server already emits — no plugin, no
  `jsxImportSource`, no build change of any kind
  ([`comparison.md`](comparison.md#31-a-diff-that-names-a-component-and-a-file)).

## Where each claim is measured

| claim                                                                       | where                                                                                                                             |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A diff names a cause, a place and a file, against a real incumbent's runner | `cases/incumbent-case` — **6 hit, 1 false alarm, 1 deferral** against 3 hit, 3 miss                                               |
| Both tiers agree on the dimensions both can observe                         | 38/38 under jsdom, 39/39 under Chromium, on `examples/kitchen-sink`                                                               |
| A component's hash covers its own nodes, so one edit changes one component    | `examples/todomvc/src/closure.test.tsx`                                                                                         |
| The suite shares renderings, and which examples watch the same bytes        | `examples/todomvc/src/composition.test.tsx` — 26 shared renderings, 0 divergences                                                 |
| Wiring separates two byte-identical documents                               | `examples/todomvc/src/fiber.test.tsx`                                                                                             |
| A remount is invisible to the document                                      | `packages/react/src/identity.test.tsx` — the two renders serialize identically, while the UI reads `1 of 1` against `0 of 1`      |
| Detecting cross-pollution beats rinsing it away                             | `packages/session/src/cost.measure.ts` — 3–4× faster, probe overhead ~2% of session time; re-measured every run, asserted as a floor |
| Which bands a single prop reaches                                           | `examples/todomvc/src/contrast.test.tsx` — seven props, five distinct sets                                                        |

## What none of this establishes

**One machine and one Chromium.** Every timing and every instability probe comes
from one M-series Mac, and every probe _simulates_ its cause — a smoothing mode,
not a different GPU driver; a second browser context, not a second runner. Varying the machine is not available from inside a test.

**One corpus, written by the people who wrote the implementation.** Ground truth
was declared before the pipeline existed, which is worth something, and no
third-party component library has been run through any part of this.

**Two readings are a floor and never a ceiling.** A subject that reads
differently one time in fifty passes this forty-nine runs out of fifty, and an
absent finding means _this run's two readings agreed_ — never _this subject is
stable_.

**Four causes of variance are absorbed by nothing**, and they are named in
[`flakiness.md`](flakiness.md#the-causes-and-who-deals-with-each) rather than left
for a reader to discover.

---

**Further.** [`flakiness.md`](flakiness.md) — the position on variance, and the
taxonomy of what absorbs each cause ·
[`composition.md`](composition.md) — the suite compared to itself ·
[`framework.md`](framework.md) — what the fiber answers that the document cannot ·
[`history.md`](history.md) — the questions that need a record ·
[`stabilization.md`](stabilization.md) — prevention, which runs before any of this ·
[`gates.md`](gates.md) — whether that adds up to a replacement for what you pay for
