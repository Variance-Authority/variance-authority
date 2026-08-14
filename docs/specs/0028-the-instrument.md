# Spec 0028 — the instrument that records the path, not the percentage

**Missing:** the transform, the probes, the worker runtime, and the runner
seams. No source is instrumented, `variance` has no command that runs a test
suite, and the two numbers that decide
[0027](0027-a-test-is-selected-by-what-it-executed.md) — probe density and
instrumented overhead — cannot be measured until this exists.
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
Measured over this repository's 301 product files: **9,961 probes**, 33 per
file, **0.355× Istanbul's 28,083 statement sites**.

| Probe | Count | What it means |
|---|---|---|
| module | 301 | the module's top level evaluated |
| function entry | 2,512 | entered, and owns every statement before the first decision |
| branch outcome | 3,724 | `if`/`else`, including the **synthesized** `else` of a bare `if` |
| continuation | 2,083 | the region *after* a decision, up to the next one |
| `await` resume | 504 | execution came back — the stack after is not the stack before |
| loop body | 589 | the body was entered at least once |
| `switch` case | 111 | per clause, plus a synthesized `default` where none is written |
| handler | 137 | `catch` and `finally` |

**A decision carries no probe of its own.** Its outcomes do. A bare
`if (c) { A }` gets both *entered* and *fell through*, because a change to `c`
must reach every test that ever evaluated it.

**Ternaries, `&& || ??` and `?.` are not decisions in v1**, and this is the
brief's own rule: for `if (order.isPremium && order.total > 100)` the fact worth
recording is which branch ran, not which operand short-circuited. They belong to
their containing region. Adding them costs 2,659 more probes and moves the
density to 0.449× — a real option, priced, and deliberately not taken first.
Mark the site with `// TODO:` rather than a paragraph.

**2. Span-based insertion, not a re-print.** `oxc-parser` gives a full AST with
UTF-16 code-unit spans, so probes are spliced at offsets and the rest of the
file is untouched. Nothing is re-printed, so the source map stays trivial and
the output stays diffable. The transform shares its parse with the reader that
already runs.

**3. The worker runtime, and the flow is the point.** A per-worker `Uint32Array`
of counters indexed by block ordinal, plus a maintained stack so each crossing
records *how it was reached*. Exception correctness is required — an unwound
frame must pop — and it is the reason the stack costs about two percentage
points rather than nothing.

Measured on realistic work: counters alone 1.03×, counters plus stack plus
`try/finally` **1.05×**. Measured on a tight arithmetic loop, where the probe is
weighed against a two-nanosecond function and nothing else: 2.40× and 3.32×.
**The second pair is the ceiling, not the expectation**, and both belong in the
record because the honest number depends on which one the suite resembles.

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

**5. Three hazards that are silent when wrong.**

- vitest hoists `vi.mock` calls in its own transform, and `enforce: 'post'` runs
  after that hoisting. The module probe must be inserted at the **first
  executable statement after the hoisted block**, never at offset 0 — a probe
  above a hoisted mock changes evaluation order.
- `Function.prototype.toString` returns instrumented text. Anything comparing
  function source, and any framework reading parameter names from it, sees the
  probe.
- A bare `if` whose `else` is synthesized must not rebind a dangling `else`
  further out.

**Acceptance is differential execution, and it catches all three.** Run this
repository's 164 test files instrumented and uninstrumented and assert identical
results and identical exit codes: 2,165 passing, 48 skipped, 20 todo. Then
report `o` against the uninstrumented 38.29 s. That single test needs none of
the other specs.

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
