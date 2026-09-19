# Instruments

A subject came back `changed`. Whether that difference is real, and what caused
it, are two further questions, and by eye they are answered one image at a
time. The **instruments** catalogued here are the repeatable alternative:
each one holds everything still, varies exactly one thing, and reads a
representation cheap enough to read again.

Three stages, and they are not equally expensive here:

| stage          | the question                                      | what it costs                                                                                                             |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **detect**     | did anything change?                              | almost nothing — a subject whose document digest equals the one its baseline was painted from is settled without a render |
| **adjudicate** | is the difference real, and is it _this_ subject's? | one collection per changed subject, and never a paint                                                                   |
| **attribute**  | what caused it, and where is it written?          | a fold over digests the run already produced                                                                              |

That profile is inverted from the usual one, and it is the whole design. Because
detection is nearly free, the budget goes into the two stages that decide whether
anybody's afternoon is spent well — which is also why reading every subject twice
is affordable at all.

## Every instrument varies one thing

There is one rule underneath all of them: **hold everything still, vary exactly
one thing, and read a representation cheap enough to read again.** A semantic
snapshot is text. In the todomvc Chromium benchmark, reading the document takes
3.0 ms and painting the same page in the same process takes 54.0 ms: **roughly
eighteen times as much**. Each figure is a per-story mean over one pass of that
suite's eighteen stories, on one machine and one Chromium. Both the timings and
their ratio describe that workload and measurement environment. They support
repeated semantic readings on this fixture, not a machine-independent
performance guarantee.

Two words below carry most of the report's meaning. A **band** is a category of
visual difference — `a11y`, `geometry`, `token`, `content`, `texture` — so
`Clock (content)` says a string changed inside `Clock` and nothing else did. A
**tier** is a level of observation: the structure-and-style reading of a
document, which any DOM host produces without a browser, and the painted image,
which only a browser can. A tier declares the dimensions it cannot see instead
of answering anyway — jsdom reads structure, roles and names, text and declared
style, and Chromium adds geometry and the raster.

| instrument                                                              | varies                  | holds                  | names                                                                         |
| ----------------------------------------------------------------------- | ----------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| **baseline comparison**                                                 | the revision            | the subject, the world | a component, a band, a `file:line`                                            |
| **[`again`](flakiness.md#what-still-gets-through-and-how-it-is-found)** | time                    | the world              | `unstable`, with the component and band that changed                          |
| **[`alone`](flakiness.md#test-order-and-shared-state)**                 | the world               | time                   | `order-dependent`, and `accept` refuses it                                    |
| **[composition](composition.md)**                                       | the subject             | the revision           | echoes, divergences, and why each component changed                           |
| **[variation](variations.md)**                                          | the subject, on purpose | the revision           | what a declared variant changes, and whether that changed                     |
| **[history](history.md)**                                               | the run                 | the subject            | recurrence, sweeps-since, and [drift](history.md#how-far-a-token-has-drifted) |
| **the engine**                                                          | the observer            | everything             | which tier can decide, and which cannot see it                                |

Each row is a controlled experiment, and the discipline of one variable is what
lets the answer be a sentence instead of a probability. It is also why the rows
compose: `again` and `alone` vary opposite things, so running both on one changed
subject partitions three causes that arrive identically.

History is the one instrument whose evidence crosses runs. It contributes
recurrence and drift only when configuration names an endpoint and token and
the run has an identity ([how to turn it on](history.md#start-the-service-and-point-your-config-at-it)); otherwise
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
it. Varying one condition per second reading keeps those causes distinguishable.

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

| what it finds | why no comparison catches it | what has been read |
| --- | --- | --- |
| **inspection findings** — a control with no accessible name, a string nobody translated | it has always been wrong, so it never _changes_ | **measured** — nine rule families (unnamed control, image without alt, skipped heading level, nested interactive, dangling reference, label mismatch, duplicate landmark, table without headers, positive `tabindex`), each with a case that reports and a case that holds, so a rule that fires on a correct page fails the suite |
| **[remounts](framework-reference.md#markrender-and-remountedsince)** — an instance destroyed and rebuilt rather than updated | identical `outerHTML`, identical `rendering`, identical `wiring`. What differs is the state, the focus and what the user typed | **measured** — the remount row in the table below, plus a first mount, a freshly mounted page and a subtree that bailed out without committing, none of which is reported as a remount |
| **[wiring](framework-reference.md#wiringof)** — a lost `memo`, an unkeyed list, a context subscription | two byte-identical documents that are two different components | **measured** — the wiring row in the table below |
| **[a Suspense boundary still open](stabilization.md#pendingsuspense--the-boundary-that-has-not-arrived-by-name)** | a component that suspends renders no markup for a marker to attach to, and both runs agree on a skeleton | **measured** — a waiting boundary reads `pending`, names the components above it and the one that created it, counts how many boundaries enclose a nested one, carries the author's key, and reads `resolved` from the same walk once the promise settles. A boundary outside the subject is not reported, and a node React never rendered returns nothing rather than a guess |
| **[asset bytes behind an unchanged URL](stabilization.md#a-url-your-build-did-not-name-is-hashed-on-the-wire)** | no markup and no computed style can see a re-exported logo | **measured in Chromium** — an image changing behind an unchanged URL changes the environment key; the digests cover only the assets the subject itself references, are recorded for the document as well as the capture, and are visibly empty rather than absent when the watch is off |
| **[a substituted font](stabilization.md#what-runs-and-what-it-absorbs)** | two runs of the substitution compare `unchanged` — true, and worthless | **measured** — the probe reports a family it could not resolve and refuses to call it absent; with no browser, fonts read as `unprobed` rather than as none missing, and neither outcome fails the exit code |

The last row of that table is the one worth stating separately, because it is
about the instrument, not the page: **reading a subject twice catches
instability in the observer, which no assertion about a verdict can see.** The
worked case is a Blink attribute-order effect that changed a document digest while
leaving the verdict entirely correct. Left in place, it can turn the cheap tier off
for later runs, and whether it does depends on the collection history of the run
that recorded the baseline
([`flakiness.md`](flakiness.md#the-class-of-defect-a-second-reading-reaches)).

### Five instruments that never open one

Those rows are about defects a comparison cannot find. These are readings that
do not attempt one: each answers _what happened in this run_, which is a
different question from _is this different from what you agreed_, a shift set out
in [ask a question the test did not ask](observability.md). Each is installable
on its own.

| instrument                                                | the question                                                  | what it needs                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| **[Eyes](eyes.md)**                                       | which elements did this test address, and who rendered them?  | the React Testing Library or Playwright already in the suite          |
| **[Vantage](vantage.md)**                                 | what is this run saying, while it is still saying it?         | one environment variable, and a process to watch from                 |
| **[scenarios](scenarios.md)**                             | at which Act did two executions stop agreeing?                | a scenario named in the test that already walks it                    |
| **[journeys](journeys.md)**                               | which path through the source did this execution take?        | a build carrying the probes, and nothing else for one process         |
| **[divergence](composition.md#one-input-two-renderings)** | one props digest, more than one rendering — from which input? | two renderings in one run, which a suite is usually already producing |

None of them writes a baseline, an approval, a history row or an exit code.

## One vocabulary across all three stages

The stages hand each other the same three things — a **component**, a **band**,
and a **`file:line`** — which is what makes the chain readable end to end
rather than three separate tools.

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

| claim | what was measured |
| --- | --- |
| A diff names a cause, a place and a file, against a real incumbent's runner | Eight edits to one component tree, declared in a file owned by neither arm before either arm ran, and graded on _must a reviewer be told?_ rather than on _did the image change_: **6 hit, 1 false alarm, 1 deferral** against 3 hit, 3 miss. The incumbent is Playwright's own `toHaveScreenshot`, executed by `playwright test` in its own process on the same page; its comparator is `pixelmatch`, the one behind most of the market. One Mac, one Chromium, eight scenarios — a scoreboard, not a win rate |
| Both tiers agree on the dimensions both can observe | Forty declared cases, scored in one run so it compares two observers rather than two runs: 38/38 agreed under jsdom, 39/39 under Chromium, no real change reported as unchanged on either. The totals differ by one case whose wrapper dimension the jsdom profile declares it cannot see, which is scored under Chromium and left undecidable under jsdom; a fortieth case is held out ungraded because the two defensible readings of portalled content give opposite verdicts |
| A component's hash covers its own nodes, so one edit changes one component | Two edits across a twelve-component design system, each read over the whole suite rather than one story, because a containment failure shows up where the component is nested deepest. A padding change to `Button` changes `Button` and no ancestor of any `Button`; a border-radius token change changes the five components that resolve through the token and leaves the other seven unchanged, including five that enclose the ones that changed |
| The suite shares renderings, and which examples watch the same bytes | 26 echoes, every one of them crossing a subject boundary, with one chip story matching four pages byte for byte, and 0 divergences. Three button stories report no echo at all, which is the finding rather than a gap |
| Wiring separates two byte-identical documents | Two components emitting identical HTML agree on every hash the collector records for them — `rendering`, `structure`, `semantics`, `text`, `style` — and differ in the wiring band: `useState` and `useContext`, a `memo` wrapper and a theme context on one, an empty wiring on the other. Empty, not absent: a page no adapter could read must not compare equal to one read and found to declare nothing. Read again after a re-render, the wiring holds while text and rendering change, which is what qualifies it as a band rather than a flake generator |
| A remount is invisible to the document | The two renders serialize identically while the UI reads `1 of 1` against `0 of 1` — one page kept the click, the other threw it away. The finding names the rebuilt component and the owner that rebuilt it, and reports the author's `key` where there was one instead of filtering itself away |
| A subject already settled by its digest is not painted | On a document digest equal to the one the baseline was painted from, the verdict is `unchanged` with no render. A changed document renders, an absent baseline renders so the subject can be accepted at all, and a baseline another machine painted refuses the shortcut rather than reusing it |
| Detecting cross-pollution beats rinsing it away | Thirty subjects through one jsdom world against thirty rebuilt worlds, 300 CSS rules apiece: one world built against thirty, ~68% of the rebuild regime's clock spent building worlds, ~2% of the session's own clock spent on the probes that replace the rinse. Those three are re-measured every run and bounded away from the current reading — exactly one world, over half, under 15% — so none can rot silently. The end-to-end speedup that follows is printed and gated by nothing: it divides two separately-timed runs, and load alone takes it from 3.2× on an idle machine to ~1.1× under a parallel suite |
| Which bands a single prop reaches | Seven props of one small design system touch five distinct sets of bands, from one band to three, asserted as a single shape because the shape is the finding. Under jsdom the reading reports geometry as unavailable rather than as unmoved |

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

**Four causes of variance are absorbed by nothing.** A framework still
committing after the wire has gone quiet — reported by name, because the tap has
to be installed before `react-dom` loads and a collector arriving at someone
else's page cannot guarantee that. Random seeds and unsorted data — a real
change, where the fixture is the bug. Cross-origin stylesheets and third-party
iframes — a sheet nobody can read fingerprints as `unreadable` and compares
equal, so a change inside one is invisible. And JSX reindented inside a block,
which renders identically and changes this tool's hash, where a pixel differ gets
it right. [`flakiness.md`](flakiness.md#the-causes-and-who-deals-with-each)
carries the full taxonomy and what each of the other causes is absorbed by.

---

**Further.** [`flakiness.md`](flakiness.md) — the position on variance, and the
taxonomy of what absorbs each cause ·
[`composition.md`](composition.md) — the suite compared to itself ·
[`framework.md`](framework.md) — what the fiber answers that the document cannot ·
[`history.md`](history.md) — the questions that need a record ·
[`stabilization.md`](stabilization.md) — prevention, which runs before any of this ·
[`gates.md`](gates.md) — whether that adds up to a replacement for what you pay for
