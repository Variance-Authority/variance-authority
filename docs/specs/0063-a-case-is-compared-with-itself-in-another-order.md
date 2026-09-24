# Spec 0063 — a case is compared with itself in another order

**Missing:** two readings of the same case that can be compared. The case index
(`<coverage file>.cases.bin`) is rewritten whole by every run, keeps no trace of
the order its cases ran in, and does not say what source it was recorded over.
So a case whose journey depends on what ran before it is recorded once, in one
order, and trusted. The memoized fixture proves what that costs: a case answered
from a cache is not a reader of the function behind it, and a case answered from
a cache filled under a mock is not a reader of the function that was mocked
([`memoized.integration.test.ts`](../../packages/sense/src/test-selection/memoized.integration.test.ts)).
Case selection (0059) would skip both.
**Built on:** `writeCaseIndex` and the case fold (`case-fold.ts`), `ExecutionTest`
ids derived from file and name, `journeyDivergences` (the same comparison across
observers of one module, within one recording).

## Purpose

A recording is one order's answer. Every runner already offers another order,
and the recording can already say which regions each case ran. Put two readings
of the same source side by side, and a region one reading of a case ran and the
other missed is the proof: that case reads state something before it wrote. It
is unstable, and its record cannot be trusted to skip it.

This is detection, not a fix. Nothing clears a cache, resets a module or
reorders a suite by itself. The user asks the runner for another order; the
recording notices the order changed and says what that did.

## What would discharge it

**1. Each case records what ran before it.** The fold keeps, per case, the
ordinal it started at within its module graph: within its file under per-file
isolation, and within its worker's sequence of files when the graph is shared
(`--no-isolate`, a Playwright worker). The cases before it in that sequence are
its predecessors. Today the fold sorts test rows by name, and arrival order is
discarded.

**2. The index says what source it stands on, and git answers it.** Each module
row records the git object name of the text it was instrumented from. Git
already knows it; nothing is hashed by us. Two readings are comparable for a
module only when its object name matches in both, and for a case only when every
module it ran matches.

**3. The fold keeps the previous reading instead of replacing it.** Before
writing, the fold opens the existing case index. Where the new reading and the
old one agree on a case's source, it compares the two region sets for that case;
where they do not, the old reading is dropped as today. The comparison is kept
in the index beside the regions.

**4. Two verdicts, split by predecessors.**

| The two readings of a case | Predecessors differ | Predecessors are equal |
|---|---|---|
| Ran the same regions | stable over those orders | no evidence |
| Ran different regions | **order-dependent** | **unsteady** — something other than order, a clock or a race |

An order-dependent case names each region that only one reading ran, and its
candidate writers: the cases that preceded it in the reading that missed the
region and not in the reading that ran it. A candidate is a lead, not a verdict,
exactly as with visual order dependence (0012). A case whose name is not unique
in its file is not paired and is reported as unpaired; Jest assigns `#n` as the
cases run, so under `--randomize` two duplicates can swap.

**5. Any order the runner offers counts, because the comparison reads
predecessors, not a shuffle flag.**

| Runner | Another order, through its own options |
|---|---|
| Vitest | `--sequence.shuffle.tests` or `--sequence.shuffle.files`, always with `--sequence.seed`; without a seed a tests-only shuffle falls back to `Date.now()` and prints nothing |
| Jest | `--randomize --seed`; shuffles within each `describe` block, never files |
| Rstest | no shuffle; `--testNamePattern` runs a case without its predecessors |
| Playwright | no shuffle; `--grep` or `--test-list` runs a case without its predecessors, and `--fully-parallel` changes which cases share a worker |

A case run alone is the strongest second reading there is: it has no
predecessors, so every region it ran and its in-order reading missed is a
dependency on something before it. The record takes the seed from the resolved
configuration where the runner has one, and reports it with the verdict.

**6. An unstable case is not trusted to be skipped.** The index keeps the union
of both readings, so a change to the price body or the locale selects the case
that only the other order credited. Beyond that, case selection answers a file
holding an order-dependent or unsteady case at file grain: another order may
still show a region neither reading ran. The mark stays until the object name of
the test file or of a module in a named region changes.

**7. The verdict is read where divergence is read already.** `variance journeys`
lists order-dependent and unsteady cases beside parting regions, with the
regions, the candidates and the seed of each reading.

**Acceptance, as scenarios**, over the memoized fixture:

- `cart.case.ts` recorded in order, then `-t 'reads the price again'` recorded
  alone: `reads the price again` is order-dependent on the price body, and
  `computes the price` is its candidate.
- The same pair of readings in the other order of recording gives the same
  verdict: the comparison has no first and second.
- `checkout.mocked.ts` recorded in order, then `-t 'prices in dollars'`
  alone: `prices in dollars` is order-dependent on the price body and on the
  locale line, the candidate is `prices in euros`, and a change to the locale
  afterwards selects `prices in dollars`.
- Two readings with equal predecessors and different regions, forced by a case
  that branches on `Math.random()`, are unsteady and name no candidate.
- A reading after an edit to `price.ts` drops the comparison for every case that
  ran it, and says so.

## Out of scope

**Finding the order that breaks a case.** The mode compares the orders it was
given; it does not search for more. Bisecting predecessors from a named
candidate is an agentic flow, as it is for visual order dependence.

**Seeing through the cache.** The comparison proves a dependency exists and
where it shows. It does not make the first reading complete, and nothing here
patches a memoizer or clears one.

**Cases that overlap in time.** A concurrent case has no single predecessor
sequence, and interleaving tests stay unsupported.
