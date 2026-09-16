# Distil a test to the behavior it witnesses

A checkout test may render a navigation bar, a clock and an order form. But
which elements does it actually use to set up the order, submit it and check the
result? Rendering the whole page does not make every part of it part of the
promise the test protects.

[`variance distill`](../packages/cli#distill-find-a-smaller-test-boundary) brings
together three kinds of evidence about the same test:

- **Which files loaded.** [Sense](../packages/sense) records the modules whose
  initialization ran.
- **Which functions and branches executed.** Sense distinguishes work done while
  loading a module from functionality the test exercised afterwards.
- **Which components the test interacted with.** [Eyes](eyes.md) records the
  elements the test queries, operates or reads during
  **[Arrange, Act and Assert (AAA)](eyes.md#read-the-test-at-the-level-it-was-written)**,
  and connects them to their React components when
  [attribution](attribution.md) exists.

Together, these readings suggest two ways to make the test smaller:

- **A file loaded, but the test never used its functionality.** Try replacing it
  with an [explicit mock](optimize-a-test.md#a-written-mock-narrows-the-next-selection-too).
  Avoiding the real module's initialization can shorten
  startup, and the mock removes a dependency that would otherwise make unrelated
  edits select this test again.
- **A component rendered, but the test never interacted with its UI.** Try a
  lightweight stand-in. If that branch contributes nothing to the behaviour
  being checked, replacing it can also remove rendering, effects and updates
  from the run. The test does less work and has fewer ways to be disturbed by
  changes outside its purpose.

Keep a substitution only after rerunning the test and checking that it still
exercises the same behaviour. Initialization may supply something the test
needs, and a component can influence the result without being directly used.
Distill identifies candidates; the confirming run establishes which ones can go.

Replace `<recorded-test-id>` below with the `id` of an entry in the evidence
file's `tests` array. With both files supplied, Eyes and execution evidence must
use the same ID for Distill to connect them. A test file path works only when
the recording uses that path as its ID.

```bash
variance distill \
  --test '<recorded-test-id>' \
  --eyes .variance/eyes.json \
  --execution .variance/execution.json
```

With Eyes evidence, `--test` also accepts a unique test title, such as
`'checkout submits'`, or a title fragment that matches only one test. Distill
resolves it to the Eyes ID and looks up that exact ID in the [execution record](execution-record.md).
With execution evidence alone, supply the recorded ID.

The command is deterministic. The same inputs produce the same ordering and
the same answer; it does not open a browser, run a test, or edit source.

## The three readings

Eyes records the selectors, locators and events a test consumed while their DOM
targets were live. Each target carries its React owner path and source location
when that attribution exists. The test supplies `arrange`, `act` and `assert`
markers; Eyes records those authored boundaries and never guesses a phase from
an API name.

For that checkout test, the distinction might look like this:

| Phase marked by the test | Element used | Purpose |
| --- | --- | --- |
| Arrange | Quantity field | Set up an order for two items |
| Act | Submit order button | Place the order |
| Assert | Confirmation message | Check the result |

The navigation bar and clock can render throughout without the test addressing
either. That makes them worth investigating, not automatically safe to remove:
an unaddressed component may still influence the form or its result.

React commits in the same journal keep
[update initiators](eyes.md#one-chronology-four-different-facts) separate from all
components whose render bodies ran. Distill places an initiator inside an
addressed component path only when their structural path frames overlap. An
initiator outside the addressed paths is an entanglement to investigate: code
the test did not address initiated work during the same authored phase. It is
not proof of the source statement that scheduled the update.

Sense supplies the files entered by the exact same test id and their nearest
observed [depth](distance.md). Its [execution index](execution-record.md) is
whole-test evidence, not AAA evidence,
so distill does not assign those files to a phase. An entered file with no Eyes
target attributed to that file is a **distillation opportunity**.

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

An opportunity is not permission to mock, replace, or delete the file.
[Static reachability](source.md) describes what the test could load; execution
says what it entered; attention says what it addressed. None says what the test
would still witness after a substitution.

## Imports nothing ever calls

Read a file-level answer twice before you act on it. A named import runs its
module's top level and nothing else, so a test can reach a file without
exercising a line of it:

```tsx
import { HeavyChart } from './heavy-chart';

// The chart is imported, loaded, and never rendered.
return points.length === 0 ? <EmptyState /> : <HeavyChart points={points} />;
```

A spy reaches the same place from the other side. `vi.spyOn(totals,
'formatTotal')` leaves the module loaded and its function unreached, and the
import statement above it still reads as a use.

Distill separates the two. Every entered module is read
[region by region](execution-record.md#blocks):
[`loadedOnly`](../packages/distill#a-module-the-test-loaded-but-never-entered)
marks a module whose only crossings are the consequence of loading
it, and `unentered` names the declarations the test never reached.

```text
Loaded but not entered: 1 module(s).
  src/heavy-chart.tsx — the import ran its top level and this test entered nothing below it
    never entered: HeavyChart (lines 5-8)
    substitution to try: vi.mock('src/heavy-chart.tsx') — jest.mock and sb.mock say the same thing
```

This is a stronger reading than an opportunity and still not a verdict. Mocking
takes the module's top level with the rest, and a top level that registers a
handler, installs a polyfill, or builds a singleton is one the test may be
standing on. Write the mock, rerun the exact test, and compare the witness
before you keep it.

## One capability, three entrances

| Entrance | Use it when | Invocation |
| --- | --- | --- |
| CLI | the evidence is in portable files | `variance distill --test <id> --eyes <path> --execution <path>` |
| [MCP](agent-questions.md#distil-one-test) | a producer already supplies Eyes and Sense evidence to a connection | `variance_distill {"test":"<id>"}` |
| [`variance-authority` skill](../packages/cli#ask-the-agent-answers-without-an-agent-protocol) | an agent must turn opportunities into a smaller verified test | install the skill shipped by `@variance-authority/cli` |

The CLI and MCP tool call the same analyzer and text formatter. `--format json`
exposes the analyzer result for another deterministic consumer. The skill adds
judgment; it does not replace the reading.

## The agent loop

For each opportunity, the agent identifies the narrowest reversible
substitution, changes one boundary, and reruns the exact test. It compares the
new attention and execution witness with the original before keeping the edit.
If an assertion loses its causal path, an addressed target disappears, or an
outside update initiator reaches the retained surface, the substitution is
reverted or the test is adjusted to state the behavior it actually owns.

This is where mocking becomes justified: by a counterfactual run, not by an
unused percentage. Distill supplies the ordered work list and the evidence to
compare; the agent verifies each proposed boundary.

## Tests without Fiber

Distill does not require [React's Fiber tree](framework.md). A plain unit test or
a test over a fake component can supply only an execution index and still receive
an entered-source reading.
Without Eyes, the entered-versus-addressed opportunity comparison is unavailable.
With a complete empty Eyes journal, the addressed surface is measured empty and
the comparison can proceed. Neither case is printed as zero Fiber usage.

The current reading counts addressed target paths and entered files. It does
not claim a percentage of the Fiber tree: unmounted, hidden, lazy and
never-observed branches have different denominators, and a DOM target does not
establish that every ancestor or descendant participates in the assertion.
