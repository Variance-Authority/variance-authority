# Spec 0047 — a skip list is worth what it skips, and nothing has measured either half

**Missing:** evidence. The feature has two numbers that decide whether anyone
should use it — **how much of a suite it removes** and **how often it removes
something it should not** — and neither has ever been produced. The instrument
for the second exists and has never been run against a mutation plan, because no
plan is in the tree. The instrument for the first cannot be run at all, because
the fixture behind every published figure is not in the repository and the one
that can be rebuilt has the wrong shape.
**Built on:** [0043](0043-a-record-costs-what-the-run-cost.md) (the cost side,
which is measured), [0046](0046-the-safety-rule-lives-in-one-place.md) (the rule
a miss rate measures), [0027](0027-a-test-is-selected-by-what-it-executed.md)
(the overhead criterion still unmeasured at `:211`).

## Purpose

The cost side of this feature is the best-evidenced thing in the repository. The
value side has nothing.

Three published figures exist and they all answer *what does the record cost*:
bytes on disk, peak resident to build it, peak resident to query it. Every one
of them is a fact about the file. **Not one of them is a fact about a suite.**
A record that costs nothing and skips nothing is worthless, and a record that
skips everything and misses one failure is worse than worthless — and the
project currently cannot tell either story about itself.

This is not for want of instruments. `select-check.mjs` is the right
experiment, in the repository's own idiom: mutate a line, ask the snapshot which
test files it reaches, run the whole suite, and require every failing file to be
in the answer. It has never been run over a real mutation plan. The nearest
thing to a record of its use says the five holes it was built to catch "were
found by reading", and the only timing note says it reaches its first line.

The evidence problem is structural rather than lazy, which is why it needs a
spec rather than a task:

- **The fixtures are gone.** The files behind every published scale number are
  not in the tree, and the generator that remains produces a *uniform* shape —
  a flat count of regions per module — rather than the sampled distribution the
  published figures were taken over. The numbers are real and they are not
  reproducible from this repository.
- **One axis has never moved.** Every fixture is 2,000 test files. The axis this
  whole feature narrows along is the one nothing has varied.
- **The safety metric has no home.** `docs/metrics.md` scores rendering and
  comparison and carries no selection question at all; `docs/instruments.md` —
  the page that links the executable readings and says where each stops — names
  no selection instrument.
- **The adoption question is unasked.** The hub result says one file can cost
  most of a suite and eleven of its neighbours cost a fraction of it. Nobody has
  measured how often a real change touches a hub, and that frequency is what
  decides whether the feature is worth installing.

## What would discharge it

**1. A checked-in mutation plan, and a run of it.** `select-check.mjs` takes a
mutations JSON and there is none. The plan is committed, the run is recorded,
and the result is a count: mutations attempted, mutations that produced a
failing suite, failing files the answer named, failing files it did not. **The
last number is the miss rate**, and until it exists the safety claim rests
entirely on prose and on twenty-odd hand-built unit fixtures.

The run must also be honest about its own configuration, which today it is not:
the script calls the narrowing with no `sourceAt`, no `relations` and no
`knownAs`, and applies a safe set no shipping caller applies. A measurement of a
configuration nobody ships is not a measurement of the product
([0046](0046-the-safety-rule-lives-in-one-place.md) is the same disagreement
seen from the code side).

**2. A selectivity figure, per change size, from a corpus of real changes.**
For a body of actual commits: how many test files did the suite hold, and how
many did the record clear? Reported as a distribution, not a mean — the
interesting cases are the tail where a hub is touched and nothing is skipped.
Grounded in a public library corpus, which is the only corpus this project may
publish against.

**3. A fixture that is in the repository and has the right shape.** Either the
generator learns the sampled distribution its published figures came from, or
the published figures are re-taken over the generator that exists and the old
ones are withdrawn. A number nobody can reproduce from a clean clone is a claim,
not a measurement, and this repository's own standard for that is written down.

**4. The test-file axis is varied.** The suite size is the denominator of every
claim this feature makes. Sweep it, and state where the read side stops fitting
— the selection-side figure is already near its ceiling at a modest branch, so
the honest form of this result is a curve with an end on it, not a point.

**5. A safety row in the metrics page and an instrument row beside it.** The
question — *does a change that breaks a test always select that test* — gets the
same treatment as every other scored question here: a unit, a corpus, a
reporting rule that separates scorable from unobservable, and a named place
where the reading lives.

**6. The hub frequency, measured.** Over a public corpus' merged changes: what
share touch a file whose closure reaches most of the suite? A feature whose
value collapses on one change in three is a different product from one whose
value collapses on one in thirty, and the page that raises the question does not
answer it.

**7. The overhead criterion is discharged or withdrawn.**
[Spec 0027](0027-a-test-is-selected-by-what-it-executed.md) sets a bound on
recording overhead and nothing measures it. A stated criterion that nothing
checks is weaker than no criterion, because it reads as though something did.

**Acceptance:** a committed mutation plan and a recorded run of it over the
public corpus, reporting a miss count against the shipped configuration; a
selectivity distribution over that corpus' real changes; and both readings
linked from the metrics page with their stopping points named. A miss rate above
zero is a result, not a failure of this spec — an unmeasured one is.

## What it forecloses

**Cost is not value.** Every figure this project publishes about the record
today is a cost figure, and no number of them adds up to a reason to adopt. This
spec may not be discharged by measuring the file again.

**A number that cannot be reproduced from a clean clone is not evidence.** That
includes numbers in journals, in docblocks, and on public pages. Where one
exists, its fixture and its command come with it or it is withdrawn.

**One corpus, publicly.** The measurements here are taken over a public library
corpus. A number taken over anything else is session evidence and does not reach
a page.

**A green suite is not a safety measurement.** The suite passing under selection
proves the selection did not break the suite it selected. The question is the
tests it *removed*, and only a full run answers it.
