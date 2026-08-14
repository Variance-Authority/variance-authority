# Spec 0028 — the instrument that records the path, not the percentage

**Missing:** the worker runtime's maintained stack, the runner seams, and every
consumer. `@variance-authority/oxc/instrument` emits presence probes and the two
numbers that decide [0027](0027-a-test-is-selected-by-what-it-executed.md) —
probe density and instrumented overhead — are measured below, but nothing
records *how* a block was reached and `variance` has no command that runs a test
suite.
**Built on:** [ADR-0038](../context/adr/0038-a-change-reaches-a-component-through-files.md)
and [ADR-0041](../context/adr/0041-a-request-is-the-edge-a-binding-is-the-name.md)
(the `oxc` reader this shares a parse with),
[ADR-0004](../context/adr/0004-defer-native-acceleration.md) (native
acceleration stays behind a measured gate),
[ADR-0013](../context/adr/0013-packages-are-named-for-their-requirements.md)
(the package is named for what it requires — a runner).

## Purpose

This is the only part of [0027](0027-a-test-is-selected-by-what-it-executed.md)
that *manufactures* an artifact. Everything else consumes what it emits and can
be stubbed against a fixture; nothing can stub this. It is also a pure function
—`instrument(source, id) → { code, map, blocks }` — so it is testable with no
runner, no disk and no index, which makes it both the first thing to build and
the cheapest thing to refute.

It carries the kill criteria. If instrumented overhead exceeds 1.35×, the
project is not worth building, and no other component can tell us that.

## What would discharge it

**1. The probe set, and it is smaller than statement coverage by design.**
Measured over this repository's 297 product files by
`yarn workspace @variance-authority/oxc census`: **9,758 probes**, 32.9 per file.
Istanbul's own visitor rules, counted on the same trees, put **24,484** counters
in the same code — 13,100 statements, 2,449 functions, 8,935 branches. This is
**0.399× every counter it inserts**, and 0.745× its statements alone.

| Probe | Count | What it means |
|---|---|---|
| module | 297 | the module's top level evaluated |
| function entry | 2,449 | entered, and owns every statement before the first decision |
| branch outcome | 3,688 | `if`/`else`, including the **synthesized** `else` of a bare `if` |
| continuation | 2,038 | the region *after* a decision, up to the next one |
| `await` resume | 490 | execution came back — the stack after is not the stack before |
| loop body | 551 | the body was entered at least once |
| `switch` case | 111 | per clause, plus a synthesized `default` where none is written |
| handler | 134 | `catch` and `finally` |

The function count matching Istanbul's exactly is not a coincidence and not a
result: both give every function one entry site. The saving is entirely in the
other two columns — 13,100 statements collapse to 2,038 continuations, because a
run of statements with no decision in it is one region.

**A decision carries no probe of its own.** Its outcomes do. A bare
`if (c) { A }` gets both *entered* and *fell through*, because a change to `c`
must reach every test that ever evaluated it.

**Ternaries, `&& || ??` and `?.` are not decisions in v1**, and this is the
brief's own rule: for `if (order.isPremium && order.total > 100)` the fact worth
recording is which branch ran, not which operand short-circuited. They belong to
their containing region. The census prices them: **5,145 more probes**, moving
the density to 0.609× — a real option, priced, and deliberately not taken first.
Mark the site with `// TODO:` rather than a paragraph.

**2. Span-based insertion, not a re-print.** `oxc-parser` gives a full AST with
UTF-16 code-unit spans, so probes are spliced at offsets and the rest of the
file is untouched. Nothing is re-printed, so the source map stays trivial and
the output stays diffable. The transform shares its parse with the reader that
already runs.

**3. The worker runtime, and the flow is the point.** A per-worker `Uint32Array`
of counters indexed by block ordinal, plus a maintained stack so each crossing
records *how it was reached*. Exception correctness is required — an unwound
frame must pop.

The counters half is built and measured. `yarn workspace @variance-authority/oxc
overhead` instruments a copy of this package's own build, runs its scan against a
generated tree, and — this is the part that makes the ratio readable — measures a
*third*, uninstrumented copy the same way, so every ratio is reported beside the
noise floor of the machine it was taken on. At 545,000 increments per run against
uninstrumented code, the probes cost **under 1.2 ns each** and the ratio is inside
the band a second identical build produces against the first.

**The stack half is not built, so its cost is not claimed.** It is the part that
can be expensive — a push and a pop per region, and a `try/finally` around every
function to survive an unwind — and the honest position is that the number
arrives with the code. What the counters measurement establishes is that the
budget is not already spent.

**4. Four runner seams, by real name.**

| Need | Seam |
|---|---|
| instrument | a Vite plugin at `enforce: 'post'`, so probes land on JS after TS is stripped |
| bound module init | the custom runner's `importFile(filepath, source)` — `source` separates a setup import from a collect import |
| which test is running | `onBeforeTryTask(test, { retry })`, which carries the attempt |
| flush | `onTestFinished`, which fires **per attempt**, after `afterEach` |

Do **not** use `getCurrentTest()`. It reads a module global that, under
`test.concurrent`, is whichever test started last — and this repository has
`packages/cli/src/commands/concurrency.test.ts`, so the failure is in the corpus
on day one.

**5. Four hazards that are silent when wrong.**

- vitest hoists `vi.mock` calls in its own transform, and `enforce: 'post'` runs
  after that hoisting. The module probe must be inserted at the **first
  executable statement after the hoisted block**, never at offset 0 — a probe
  above a hoisted mock changes evaluation order.
- `Function.prototype.toString` returns instrumented text. Anything comparing
  function source, and any framework reading parameter names from it, sees the
  probe.
- **A function's source can leave the realm its probes live in.**
  `page.evaluate(fn)`, `new Function(fn.toString())` and a worker built from a
  stringified closure all ship text into somewhere the module scope does not
  exist, and an unguarded probe there is a `ReferenceError` that appears only in
  instrumented builds. Every call site is therefore guarded with `typeof`, the
  one operator that names an identifier without requiring it to resolve. In the
  foreign realm the guard is false and nothing is recorded, which is also the
  correct answer.
- A bare `if` whose `else` is synthesized must not rebind a dangling `else`
  further out.

**Acceptance is differential execution, and it caught the third.** Run this
repository's suite instrumented — `yarn vitest run --config
tools/instrumented.config.mts` — and uninstrumented, and require identical
results and identical exit codes. Both report **168 files (165 passed, 3
skipped) and 2,209 passing, 48 skipped, 20 todo**. `o` is **1.00** against an
uninstrumented 38.10 s.

That figure is a pass against the 1.35 bar and it is not a tight bound: this
suite's clock is browser I/O and one deliberate thirty-second timeout, so it
cannot tell 1.00 from 1.05. It is the `overhead` benchmark, not this, that
excludes a per-probe cost. Both belong in the record — a suite is what a
developer waits for, and a nanosecond is what scales.

## What it forecloses

**Externalized dependencies are never transformed.** Vite does not transform
what it does not inline, so a block inside `node_modules` has no probe unless
`server.deps.inline` names it. That is a hole in the index, it must be reported
as *not instrumented* rather than as *not executed*, and it is the difference
between a limit and a lie.

**A browser needs a different transport, not a different instrument.** The same
probes and the same block ids serve a Storybook story; only the path from the
page back to the index changes. Keeping the emitted runtime free of Node
built-ins is what preserves that, and it is a constraint on this package rather
than a later port.

**No Rust yet, and the gate is a number.**
[ADR-0004](../context/adr/0004-defer-native-acceleration.md) holds: JS first,
and a native collector is justified by a measurement showing the JS one is the
bottleneck — not by the volume of events sounding large.
