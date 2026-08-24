# Spec 0028 — the instrument that records the path, not the percentage

**Missing:** the worker runtime's maintained stack, the runner seams, and every
consumer. `@variance-authority/sense/instrument` emits presence probes, but
nothing runs source and tests to produce coverage data, records how a block was
reached, or joins that data to a diff to select tests.
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

## What would discharge it

**1. The probe set.** A probe records entering a module, function, branch
outcome, continuation, loop body, `switch` case, handler, or `await` resumption.
The instrument’s output is an input to coverage collection, not coverage data or
a test-selection result.

**A decision carries no probe of its own.** Its outcomes do. A bare
`if (c) { A }` gets both *entered* and *fell through*, because a change to `c`
must reach every test that ever evaluated it.

**Ternaries, `&& || ??` and `?.` are not decisions in v1**, and this is the
brief's own rule: for `if (order.isPremium && order.total > 100)` the fact worth
recording is which branch ran, not which operand short-circuited. They belong to
their containing region.

**2. Span-based insertion, not a re-print.** `oxc-parser` gives a full AST with
UTF-16 code-unit spans, so probes are spliced at offsets and the rest of the
file is untouched. Nothing is re-printed, so the source map stays trivial and
the output stays diffable. The transform shares its parse with the reader that
already runs.

**3. The worker runtime, and the flow is the point.** A per-worker `Uint32Array`
of counters indexed by block ordinal, plus a maintained stack so each crossing
records *how it was reached*. Exception correctness is required — an unwound
frame must pop. This stage executes instrumented source and tests and produces
coverage data attributed to test files; it is not complete until that data feeds
the diff-based selection stage in [0030](0030-a-diff-lands-on-blocks.md).

**4. Four runner seams, by real name.**

| Need | Seam |
|---|---|
| instrument | a Vite plugin at `enforce: 'post'`, so probes land on JS after TS is stripped |
| configuration | the user adds the integration to the runner configuration or CI job |
| coverage owner | the test file that the runner executes |
| selection output | test-file paths for the runner to execute |

The integration does not replace a runner or select individual test cases. It
uses the runner’s normal configuration surface to instrument modules and records
coverage against each test file. Storybook is different: because the tool owns
that execution surface, it may select an individual story. A Playwright page
crossing uses a transport before its coverage joins its test file.

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
  exist. The generated declarations are required, so the first foreign probe
  throws instead of silently dropping coverage data.
- A bare `if` whose `else` is synthesized must not rebind a dangling `else`
  further out.

**Acceptance is end to end.** One run must execute the instrumented source and
tests and persist coverage data per completed test file. A later source diff
must read that data and select the test files that previously entered the
affected blocks, widening whenever the data is absent, partial, or no longer
current.

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
