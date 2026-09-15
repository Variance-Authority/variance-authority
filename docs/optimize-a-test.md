# Reduce the cost of one test

A test can spend time loading modules it never calls. Variance Authority helps
you find those modules, try a smaller dependency setup, and check that the test
still exercises the behavior you care about.

This complements [test selection](run-relevant-work.md): selection reduces how
many tests run; changing a test's dependencies can reduce what it loads on each
run.

## Find a dependency to investigate

Use `variance distill` with the test's recorded source execution. Adding an Eyes
record lets it compare that source with the elements the test queried or
interacted with. See [the command and input requirements](distill.md).

For example, a component imports `HeavyChart` but renders an empty state in this
test:

```tsx
return points.length === 0 ? <EmptyState /> : <HeavyChart points={points} />;
```

The chart module's initialization still runs. The report distinguishes that
initialization from calling the chart itself:

```text
Loaded but not entered: 1 module(s).
  src/heavy-chart.tsx — the import ran its top level and this test entered nothing below it
    never entered: HeavyChart (lines 5-8)
    substitution to try: vi.mock('src/heavy-chart.tsx') — jest.mock and sb.mock say the same thing
```

A spy can produce the same result: it replaces a function while leaving the
module loaded. The report gives you the module and declarations to inspect.
It does not establish that a mock is safe.

## Try one change and rerun the test

1. Check what the candidate module does during initialization. A registered
   handler, polyfill, or singleton may be necessary even when the test calls
   none of its exported functions.
2. Try one mock or dependency substitution that preserves the test's intended
   behavior.
3. Rerun the exact test and compare its assertions, recorded interactions, and
   executed source with the original run.
4. Keep the change only if the test still exercises the behavior it claims to
   test. Revert it if a target disappears or the assertion loses the behavior
   it depended on.

For React tests, also inspect updates initiated by components outside the paths
the test interacted with. They may reveal a dependency that the proposed mock
would hide. [Distill](distill.md#the-agent-loop) describes how an agent uses
these comparisons.

## How a mock affects future test selection

The source scanner recognizes `vi.mock`, `jest.mock`, and `sb.mock` in tests,
stories, and setup files. It removes the mocked dependency from the importing
file's dependency graph. Changes to that module, or dependencies reached only
through it, can then stop selecting this test.

A spy alone does not provide that information to the scanner. Its effect is
visible during execution. An explicit mock is visible before the run begins.

`auditTaints` checks for disagreement: if a test executes a module the scanner
considers mocked, either the mock did not apply or the scanner's assumption is
wrong. See [mock and execution disagreements](selecting.md#where-the-taints-and-the-record-disagree).

## Limits

Only instrumented code can support a claim that something did not execute.
An incomplete recording is excluded from that analysis. Neither missing probes
nor a recording that stopped early counts as evidence of unused code.

`variance distill` analyzes one test at a time. Its suggestions are candidates
to verify, and it does not rank the whole suite by potential savings.

For command options and report details, continue to [Distill](distill.md).
