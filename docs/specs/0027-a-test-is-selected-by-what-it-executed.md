# Spec 0027 — a test is selected by what it executed

**Missing:** all of it. Nothing instruments a test run, nothing records which
test reached which block, and `variance` has no command that runs a test suite.
This file is the product definition — why to build it, and how it would be used.
The vacancies it splits into are [0028](0028-the-instrument.md),
[0029](0029-what-a-run-remembers.md) and [0030](0030-a-diff-lands-on-blocks.md).

**Built on:** [`selecting.md`](../selecting.md) (the static selector this
narrows, and the hole it names),
[ADR-0038](../context/adr/0038-a-change-reaches-a-component-through-files.md)
(the file graph),
[ADR-0041](../context/adr/0041-a-request-is-the-edge-a-binding-is-the-name.md)
(names on edges, and the mock layer it pre-authorizes),
[`instruments.md`](../instruments.md) (the detect / adjudicate / attribute
ladder this extends by one stage),
[ADR-0008](../context/adr/0008-per-profile-expectations.md) (blindness is not an
answer, which is why an unobserved block is never an empty one).

## Why to build

[`selecting.md`](../selecting.md) answers *which subjects could this diff have
moved* by walking a file graph backwards from a diff. It over-includes on every
uncertainty, it refuses rather than narrowing, and it works. It also names its
own hole, in its own words: **a component imported but never rendered.**

That hole is the whole product. A file graph knows what *could* reach what. It
cannot know what *did*, so it answers every question at the granularity of a
file and at the confidence of an import. Three consequences, each ordinary:

**A barrel makes everything reach everything.** One `export *` and the graph
says a change to any leaf reaches every consumer of the package. The static
answer is correct and useless.

**A mocked module is still an edge.** A test that does `vi.mock('./client')`
never executes a line of `./client`, and the graph selects it anyway — because
the import is right there in the file. This is the case where observation is not
merely sharper than prediction, it disagrees with it.

**An import is not an execution.** A helper imported at the top of a 40-test
file is reached by all 40 in the graph and entered by two.

So the number a developer sees today is *37 test files import something
connected to what you changed*. The number worth seeing is **7 tests
historically executed the code you changed, 2 of them directly** — and, because
the run recorded how it got there, the path that explains each one.

This is [`instruments.md`](../instruments.md)'s ladder one structure over. The
graph is detection: nearly free, over-reporting, and able to answer about code
that has never run. The execution index adjudicates: it under-reports by
construction — it only knows what it watched — and it is exact about what it
watched. **Neither replaces the other**, and the index narrows *within* what the
graph already reached rather than overruling it.

### Why not V8 coverage

`Profiler.takePreciseCoverage` gives per-test block attribution for free, and it
is refused on two structural grounds and one fatal one.

It is a Node inspector API, so it reaches vitest and reaches neither a Storybook
story in a browser nor a Playwright page — and one index across every origin is
the point, not a later feature. Its output is byte-offset ranges over
transformed script text, so every question has to be reconstructed through a
source map.

And it is **path-free**. There is no stack in it, so no distance, no runtime
context, no *how did this test get here*. The flow is the product, and that
alone decides it — none of the three grounds is a cost argument, so none needs a
benchmark to stand.

What the cost had to be was *affordable*, and that is measured:
[0028](0028-the-instrument.md) puts hand-written presence probes under 1.2 ns
each and `o` at 1.00 over this suite. A maintained stack is not built and its
cost is not claimed.

## How to use

The surface below is the proposed one. `tests` is not in the binary's command
table, so nothing here is runnable yet, and the fences are sketches rather than
commands.

```
variance tests
```

Runs the suite under instrumentation and records what each test executed. This
is the first run, and it is the expensive one.

```
variance tests --since origin/main
```

Diffs the working tree against what the index recorded, maps the changed lines
onto the blocks that contain them, unions the tests that historically crossed
those blocks, and runs those.

```
7 tests crossed the 3 changed blocks · 2165 total · 12s vs 38s

  src/cart/total.ts  priceOf/entry              4 tests   distance 2-5
  src/cart/total.ts  priceOf/if#0/else          5 tests   distance 2-4
  src/cart/rules.ts  applyTier/reduce.arg0      2 tests   distance 7-9
                     └ renamed — widened to the module for this run

  cart.test.ts › applies the staff discount
    priceOf ← computeTotal ← Cart.render ← test
```

Configuration joins the existing `source` key, off by default:

```json
{ "source": { "dirs": ["src"], "tests": true } }
```

Two flags carry the honest cases. `--all` ignores the index and runs
everything, which is what CI does on a schedule to keep observations fresh.
`--explain <test>` prints the recorded paths by which that test reaches the
changed blocks, because a selection nobody can check is a selection nobody
trusts.

**What it does when it does not know.** The same discipline
[`selecting.md`](../selecting.md) already holds: a file that could not be
instrumented, a test that has never run, a test that failed or was skipped, a
worker that crashed, a `git` failure — each one runs the test and says why. A
refusal never silences.

## The model

**Instrument execution boundaries, not statements.** For
`if (order.isPremium && order.total > 100) { discounted() } else { standard() }`
there are exactly two probes: entered `discounted`, entered `standard`. Neither
`isPremium` nor `total > 100` gets a probe of its own. The fact worth recording
is which outcome the runtime took.

**A decision is not a probe.** The decision is static metadata; its outcomes
carry the probes. A bare `if (c) { A }` has two outcomes — entered, and fell
through — because a change to `c` has to reach every test that ever evaluated
it.

**A block's blocks.** Module initialization; function entry, which owns
everything before the first decision; each branch outcome; the continuation
region after a decision, which is why editing the line after a guard does not
resolve to the whole function; and the resumption after an `await`.

**The historical execution stack is the dependency graph.** If `c` changes and
the record says `T1 → a → b → c`, then `T1` is affected. There is no static
propagation from `c` back to `a`, no purity inference, no effect summary, no
data-flow. This is what makes the system tractable, and it is also exactly what
bounds it: it can only answer about paths it watched.

**The path is stored as a trie.** Common prefixes are shared, test sets are
compressed per node, and the same structure answers *which tests crossed this
block* and *by what route*.

### How a diff moves the index

The diff is taken between **what the index recorded and what is on disk** — not
between a branch and a merge base. That distinction is load-bearing: no ref is
consulted, so a rebase, a squash, a branch switch and a shallow clone change
nothing, and a revert lands on records already held. Every failure mode
[ADR-0039](../context/adr/0039-the-digest-is-the-proof-the-trail-is-the-explanation.md)
enumerates for `git diff base...HEAD` is a property of inputs this diff does not
have.

Then the diff **transforms** the index rather than merely explaining it:

1. **Move what only shifted.** A hunk yields a line delta. Every block lying in
   an unchanged region moves by that delta and keeps its identity. Inserting an
   import above a function costs nothing and loses no history.
2. **Invalidate the tree where structure moved.** Where a hunk overlaps a block,
   a confident structural match keeps the identity and anything else mints a new
   one and marks the enclosing subtree changed. Uncertainty mints; it never
   guesses. **A false identity match is worse than a missed one**, because a
   missed match runs extra tests and a false one silently hands a test set to
   code it was never measured against.
3. **Burn inward.** A changed range selects every block *contained* in it, not
   only the block containing it. Without this, swapping two sibling closures is
   invisible.
4. **Back burn outward.** From each changed block, walk **up** the containment
   chain and select every enclosing block. A change inside a block can alter
   control flow *out of* it — an added `return`, `throw`, `break`, or a
   condition that now throws — so the enclosing region's behaviour is no longer
   implied by its own bytes.

Step 4 is not a widening for safety's sake; it repairs a real hole. The brief's
rule for a changed condition was *union the decision's outgoing probes*, and
that rule is unsound. A test where `x` is `undefined` throws inside `if (x.y)`,
so it entered neither branch and appears in neither probe's row. Rewrite the
condition to `if (x && x.y)` — the most ordinary defensive edit there is — and
that test's behaviour changes while the union does not contain it. Selecting the
**enclosing region** contains it, because the region was entered before the
condition was evaluated. Back burn costs zero additional probes and replaces the
enumeration with one lookup.

## What decides whether this ships

Pre-registered, before the code, because a threshold adopted afterwards is a
threshold fitted to a result. [`metrics.md`](../metrics.md)'s protocol applies
unchanged.

| | Bar |
|---|---|
| `o` — instrumented run ÷ uninstrumented run | **≤ 1.35.** Istanbul is 1.3–2.0×. Above this, the first run of the day costs more than the day saves |
| `f` — missed failures | **0** on mutants planted in blocks some test entered. The only safety metric |
| `w` — wall clock ÷ full run | **≤ 0.25** at the median commit |
| `s` — tests selected ÷ total | **≥ 5× better than the static selector** on the shared-utility and mocked strata. Parity elsewhere, reported as parity |

**And the refutation condition, which is the one that matters.** The comparator
is not only the file graph — it is Istanbul per-test coverage, which is strictly
finer-grained than block coverage and already exists. If its selection ratio is
within a few points of this design's and its overhead is comparable, **this
design has no case, and the honest outcome is to say so and ship the Istanbul
path.** That sentence belongs here, before the code, or it will not be applied
after it.

One measurement precedes all of them and costs an afternoon: run one revision 20
times instrumented and count the blocks whose test set is not identical across
all 20. That number is the volatility floor — the hard bound on how much of any
suite can *ever* be safely excluded — and if it is bad, the rest is moot.

## What it forecloses

**It cannot answer about code that has never run.** A test that would *newly*
enter a region — because the change added a call that did not exist — is
invisible to every execution index ever built, including Wallaby's. That gap
belongs to the static graph, which is why the graph stays and why this narrows
within it rather than replacing it.

**The first run is a full run, and so is the first run after a toolchain
change.** An index from a different instrumentation mode or a different compiler
is discarded rather than trusted.

**A module-scope edit degrades to the module.** A four-hundred-line file of
top-level constants has one initialization block, so editing any of them selects
every test that loaded the file. That stratum should be reported as a near-tie
with the static selector, not folded into a headline.

**The index is a cache and never an input to correctness.** Missing, stale,
foreign or corrupt, it costs a full run and can never cost a skipped test. This
is the same claim
[ADR-0040](../context/adr/0040-git-already-named-every-files-content.md) makes
for the scan caches, and it is what makes where the index lives a cost decision
rather than a correctness one.
