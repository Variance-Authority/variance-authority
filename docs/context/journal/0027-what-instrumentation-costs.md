# 0027 — what instrumentation costs

[Spec 0027](../../specs/0027-a-test-is-selected-by-what-it-executed.md) is worth
building only if two numbers hold: the probe set has to be *smaller* than statement
coverage rather than a rename of it, and an instrumented suite has to stay under
1.35× an uninstrumented one. Both were pre-registered before the transform existed.
Both are now measured, and one of them turned out to be the wrong instrument for
the question.

## The reproduction

```bash
yarn workspace @variance-authority/oxc build
```

```bash
yarn workspace @variance-authority/oxc census
```

```bash
yarn workspace @variance-authority/oxc overhead
```

```bash
yarn vitest run --config tools/instrumented.config.mts
```

The census instruments every product file in this repository and counts what it
placed. The overhead benchmark copies this package's own build three times,
instruments one copy, and times a real scan through each. The last command is the
suite itself, run through the transform.

## The probe set is 0.4× Istanbul

```
297 product files, 0 unparseable, instrumented and re-parsed in 223 ms

  module           297    3.0%
  function        2449   25.1%
  branch          3688   37.8%
  continuation    2038   20.9%
  resume           490    5.0%
  loop             551    5.6%
  case             111    1.1%
  handler          134    1.4%
  TOTAL           9758

  32.9 probes per file

  Istanbul, by its own rules on the same tree:
    statements   13100
    functions     2449
    branches      8935
    counters     24484

  0.745x its statements
  0.399x every counter it inserts
  expression-position decisions would add 5145 probes — 0.609x
```

The comparator is Istanbul's *rule*, not Istanbul's output: its visitor list is
transcribed into the census — a `VariableDeclarator` is a statement and its
`VariableDeclaration` is not, an `if` is one statement and two branches — and
applied to the same `oxc` trees. It is a ratio between two models and does not
need Babel installed to be worth having.

The function column matching exactly is structural, not a finding: both models give
every function one entry site. The whole saving is that 13,100 statements collapse
into 2,038 continuation regions, because a run of statements with no decision in it
is one region and one arrival condition.

The census re-parses every instrumented file and fails on the first that no longer
compiles. Three hundred files of real TypeScript is a far broader correctness check
than the fixtures, and it is what caught the emission bugs that fixtures did not
happen to cover.

## The suite cannot see the probes

```
                    files                          tests                    real
uninstrumented      165 passed, 3 skipped          2209 / 48 skipped / 20 todo   38.10 s
instrumented        165 passed, 3 skipped          2209 / 48 skipped / 20 todo   38.60 s
```

Identical results, identical exit codes, `o` = **1.00** against a 1.35 bar.

That is a pass and it is a weak bound, which is worth saying plainly rather than
banking. This suite's wall clock is browser I/O plus one deliberate thirty-second
timeout in `renderer.test.ts`; instrumented product code is a small share of it. A
suite shaped like this would report 1.00 for a probe that cost five percent.

## So the probe was measured against its own noise

```
9 modules instrumented, 458 probes, 0 refused

2000 components, best of 5

  arm                          plain    probed      o  control  increments
  cold  — every file parsed    541 ms    539 ms  0.996    0.978    3,755,530 (within noise)
  warm  — nothing parsed       145 ms    146 ms  1.004    1.004    2,726,960

  control is a second uninstrumented copy, measured identically
  cold: 751,106 increments per run — under 16.0 ns each at this noise floor
  warm: 545,392 increments per run — under 1.2 ns each at this noise floor
```

The **control** column is the load-bearing one. It is a third copy of the same
build, uninstrumented, timed exactly as the probed copy is. Without it, `0.996` and
`1.004` are two numbers a reader is invited to over-read; with it, they are inside
the band two identical builds produce against each other, and the honest statement
is that the probes are under the resolution of the measurement.

What that still excludes is worth carrying: the warm arm does no parsing at all, so
nearly every millisecond is this package's own instrumented JavaScript, and 545,000
increments land in it per run without moving the clock past the noise. A probe
costs **under 1.2 ns**.

The two arms differ only in how diluted the instrumented code is. Cold spends most
of its time inside the native parser, which carries no probes — which is also why a
real suite reports 1.00. Most of a program's clock is spent somewhere the probes
are not.

## What is not measured

**The maintained stack.** Everything above is presence only: a counter per region.
The stack that makes this an execution *graph* rather than coverage — a push and a
pop per crossing, and exception correctness so an unwound frame still pops — is not
built, so its cost is not claimed. Spec 0028 previously carried figures for it;
they are removed rather than restated, because the code they described does not
exist and a number without a script under `packages/*/scripts/` is not a number.

**V8's per-test cost.** Spec 0027 rejected `Profiler.takePreciseCoverage` on three
grounds, and the comparison of its overhead against hand-written probes was one
sentence too many: the rejection is structural — Node-only, byte offsets over
transformed text, and path-free — and none of the three needs a benchmark. The cost
comparison is gone.

## What the differential run found

Twelve files, forty-eight failures, one cause: `ReferenceError: __va is not
defined` inside `page.evaluate`, and inside `preview-fake.ts` rebuilding a function
from `fn.toString()`. A function's *source* crosses into a realm where the module
scope that holds its probes does not exist.

Every probe call site is now guarded with `typeof` — the one operator in the
language that names an identifier without requiring it to resolve. In the page the
guard is false, nothing is recorded, and nothing throws; that is also the correct
semantics, because the execution happened somewhere this index does not reach.

This is the whole argument for differential execution as the acceptance test. The
hazard was written into the spec as a prediction before the code existed, and it
still took running the real corpus to find *where* it bites and how much of it there
is. Fixtures cover what somebody thought to write down.
