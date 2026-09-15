# Find dependencies a test may not need

`variance distill` compares the source a test executed with the elements it
queried or interacted with. It lists files to investigate when you want a test
to load less code.

Supply a recorded execution index and, for the interaction comparison, an Eyes
record from the same test. [Eyes](eyes.md) records the interactions;
[execution journeys](journeys.md) describes the source record.

```bash
variance distill \
  --test 'checkout submits' \
  --eyes .variance/eyes.json \
  --execution .variance/execution.json
```

The command is deterministic. The same inputs produce the same ordering and
the same answer; it does not open a browser, run a test, or edit source.

## The three readings

The report combines three kinds of information:

- **Interactions:** Eyes records the elements the test queried or interacted
  with, including their React component paths and source locations when
  available. Explicit `arrange`, `act`, and `assert` markers group the activity
  by test phase; the recorder does not infer phases from query names.
- **React updates:** the record distinguishes components that initiated an
  update from components that rendered because of it. An update initiated
  outside the component paths the test interacted with is a dependency to
  investigate. It does not identify the source statement that scheduled it.
- **Executed source:** Sense records files executed by the same test ID. This
  record covers the whole test, so the analyzer cannot assign files to an
  arrange, act, or assert phase. It displays depth when the input supplies it;
  the native source recorder does not record call depth.

A file that executed without being associated with an interaction appears as a
**distillation opportunity**: a candidate for simplifying the test's dependencies.
For an input that supplies depth, the report can look like this:

```text
act:
  components: CheckoutForm
  source: src/checkout/form.tsx

React update initiators:
  act: 2 commit(s)
    inside addressed component paths: CheckoutForm
    outside addressed component paths: Clock

Runtime journey: 4 source file(s) entered by exact test id.
Entered with no addressed target attributed to the same file: 2.
  distillation opportunity at depth 4 — src/analytics.ts
  distillation opportunity at depth 5 — src/top-nav.tsx
```

Inspect an opportunity before changing it. Executing a file without interacting
with its elements does not establish that the file is unnecessary: it may
provide data, setup, or side effects the test relies on.

## Imports nothing ever calls

An import can run a module's initialization without calling its exports. For
example, a test may load `HeavyChart` but render only the empty state:

```tsx
import { HeavyChart } from './heavy-chart';

// The chart is imported, loaded, and never rendered.
return points.length === 0 ? <EmptyState /> : <HeavyChart points={points} />;
```

Distill examines the recorded functions and branches within each module.
`loadedOnly` means the test executed only initialization work. `unentered`
lists declarations it did not execute.

```text
Loaded but not entered: 1 module(s).
  src/heavy-chart.tsx — the import ran its top level and this test entered nothing below it
    never entered: HeavyChart (lines 5-8)
    substitution to try: vi.mock('src/heavy-chart.tsx') — jest.mock and sb.mock say the same thing
```

This is a more specific candidate than a file with no recorded interaction.
Check its initialization before mocking it: that may register a handler, install
a polyfill, or create a singleton the test needs.
[Reduce a test's cost](optimize-a-test.md) explains how to verify the change and
how an explicit mock affects future selection.

## One capability, three entrances

| Entrance | Use it when | Invocation |
| --- | --- | --- |
| CLI | you have saved record files | `variance distill --test <id> --eyes <path> --execution <path>` |
| MCP | your connection supplies Eyes and Sense records | `variance_distill {"test":"<id>"}` |
| `variance-authority` skill | you want an agent to try and verify dependency changes | install the skill shipped by `@variance-authority/cli` |

The CLI and MCP tool use the same analyzer and text output. Use `--format json`
for structured results. Neither runs tests or edits source. The skill guides an
agent through making and checking a change.

## The agent loop

For each candidate, the agent tries one reversible substitution and reruns the
exact test. It compares the recorded interactions and executed source before
keeping the edit.

The change needs further work or reversal if an assertion loses the behavior it
depended on, a target disappears, or an update initiated outside the tested
component paths affects the part of the UI the test retains. A passing assertion
alone does not establish that the smaller test still checks the intended behavior.

## Tests without Fiber

React is optional. A plain unit test can supply only an execution index and get
a report of executed source. Without Eyes, the comparison between executed files
and recorded interactions is unavailable.

An empty, complete Eyes record is different: it establishes that no interactions
were recorded, so the comparison can proceed. Missing or incomplete recording
cannot establish that something was unused.

The report counts recorded target paths and executed files. It does not report
what percentage of a React component tree the test covers, or whether every
ancestor and descendant of a target contributes to an assertion.
