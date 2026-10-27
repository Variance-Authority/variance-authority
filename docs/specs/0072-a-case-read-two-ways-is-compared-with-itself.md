# Spec 0072 — a case read two ways is compared with itself

**Missing:** a second reading of a case, and anything that compares it with the
first. The case index (`<coverage file>.cases.bin`) keeps the test files a run
did not reach (`layerCaseIndex`), but a case the
run did reach replaces its old reading unread, and the index does not say what
source it was recorded over. So a case whose journey
depends on state something else left behind is recorded once and trusted. The
memoized fixture proves what that costs: a case answered from a cache is not a
reader of the function behind it, and a case answered from a cache filled under
a mock is not a reader of the function that was mocked
([`memoized.integration.test.ts`](../../packages/sense/src/test-selection/memoized.integration.test.ts)).
Case selection (0059) would skip both.
**Built on:** `writeCaseIndex` and the case fold (`case-fold.ts`), `ExecutionTest`
ids derived from file and name, `journeyDivergences` (the same comparison across
observers of one module, within one recording).

## Purpose

Two readings of one case over the same source should run the same regions. When
they do not, the case reads state it did not set, and its record cannot be
trusted to skip it. That is the whole test. No order has to be recorded; any
second reading will do, and there are two:

- **A focused run.** Case selection runs only the affected cases, so each of
  them runs without the cases that ran before it in the full run.
- **Another order, through the runner's own option.**

| Runner | Another order |
|---|---|
| Vitest | `--sequence.shuffle.tests --sequence.seed=N`; without a seed the shuffle falls back to `Date.now()` and prints nothing |
| Jest | `--randomize --seed=N`, which shuffles within each `describe` block; there is no reverse |
| Rstest | none; `--testNamePattern` runs a case alone |
| Playwright | none; `--grep` or `--test-list` runs a case alone |

A case run alone is the strongest second reading: nothing ran before it.

Module state is not reset for the user. A module registry reset per case hides
the dependency this spec exists to show, and nothing here turns one on, reads
one, or recommends one.

Per-case isolation that is not module state is where the performance is.
Playwright opens a fresh context and page for every test by default, and that
costs 2.3x to 6.4x the subject it isolates
([journal 0036](../context/journal/0036-the-model-picks-the-engine.md)). A file whose cases read the same on one
shared page does not need the fresh one, and the record can say so with
evidence. A file whose cases differ is the finding, with the regions that
differ, and the fix is guided rather than rinsed.

Files are not in scope. The runners here isolate test files by default, so the
state that leaks is within a file.

## What would discharge it

**1. The index says what source it stands on, and git answers it.** Each module
row records the git object name of the text it was instrumented from. Git
already knows it; nothing is hashed by us. Two readings of a case are comparable
only when every module the case ran has the same object name in both.

**2. A run compares a case before it replaces it.** The fold already keeps every
test file the run did not reach. For each case it did run, it compares the new
reading with the old one before replacing it, and a focused run of five cases
in a file keeps the file's other cases.

**3. Unequal readings make a case unstable.** The verdict names each region only
one reading ran, and says how each reading was made: a full run or a focused
one, the seed when the runner shuffled, and for a browser case whether its page
was its own.
The index keeps the union of both readings, so a later change to either region
selects the case. Case selection answers a file holding an unstable case at file
grain, because a third reading may show a region neither of these ran. The mark
stays until the object name of the test file, or of a module holding a named
region, changes.

**4. A browser case says whether its page was its own.** The collector reports
whether the case read a page it opened or one a worker-scoped fixture shared.
That is the one per-case isolation this spec compares, and the user chooses it
in their own fixtures.

**5. `variance journeys` lists unstable cases, and says where a fresh page can
go.** Every unstable case is listed with the regions only one reading ran. For
each Playwright file read on its own pages and on a shared one, it adds one of
two things:

- **Removable:** every case read the same regions on its own page and on the
  shared one. It shows the wall time of the file under each reading, as measured, and
  gates on neither.
- **Needed:** the unstable cases, with the regions only the reading on its own
  page ran. That is the state the fresh page is hiding, and removing the
  dependency is the fix.

Nothing changes the user's configuration or fixtures. The user shares the page
in their own fixture, and the record says what that did.

**Acceptance, as scenarios**, over the memoized fixture:

- `cart.case.ts` recorded whole, then only `reads the price again`, as case
  selection would run it: the case is unstable on the price body, and
  `computes the price` and `prints the price` keep their readings.
- `checkout.mocked.ts` recorded whole, then only `prices in dollars`: the case is
  unstable on the price body and on the locale line, and a change to the locale
  afterwards selects it.
- `cart.case.ts` recorded whole, then with `--sequence.shuffle.tests` under a
  seed that runs `reads the price again` first: the same verdict, and the run
  names the seed.
- A Playwright file whose cases share no state, read on their own pages and then
  on a worker-scoped one: the file is listed as removable, with both wall times.
- A reading after an edit to `price.ts` compares nothing for the cases that ran
  it, and says so.

## Out of scope

**Naming what wrote the state.** The verdict proves a dependency and shows where
it appears. Finding the case or the hook that wrote it is an agentic flow over
that evidence, as it is for visual order dependence (0012).

**Seeing through the cache.** Nothing here patches a memoizer or clears one.

**Cases that overlap in time.** Interleaving tests stay unsupported.
