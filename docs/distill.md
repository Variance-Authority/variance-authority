# Distil a test to the behavior it witnesses

A checkout test may render a navigation bar, a clock and an order form,
whether that markup comes from React, another framework, or no framework at
all. But which elements does it actually use to set up the order, submit it
and check the result? Rendering the whole page does not make every part of it
part of the promise the test protects.

Distill is a [Variance Authority](README.md) capability that asks what one
test can shed, using the execution and source evidence a run already keeps.
Where a rendered element has a React component behind it, Distill can name
that component too; React is not a requirement for the rest of the reading.
[Test selection](selecting.md) asks the same [execution record](execution-record.md)
which tests reached a set of changed lines.

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

Name the case with `--test` and the file that declares it with `--file`.
`--test` takes the recorded id, the case's exact title, or a part of the title;
`--file` takes any part of the test file's path:

```bash
variance distill --file test/checkout.spec.ts --test submits
```

When more than one case fits, Distill prints the ids of up to five of them and
stops. Pass one of those ids to `--test`. `--file` without `--test` reads the
whole file: what it loaded, and how many of its cases entered each module
([below](#imports-a-file-loads-for-few-of-its-cases)). Name neither, and Distill
reads every test file, or with `--from <dir>` every one under a folder or a
package, and ranks the imports they load for nothing
([below](#imports-a-folder-a-suite-or-the-repository-loads-for-nothing)).

Distill reads the record your last recorded run wrote, `coverage.bin`, and finds
it the way [test selection](selecting.md) does. With more than one declared
suite, name the one to read with `--suite <name>`; a reading of many test files
with no suite named reads every declared suite. Pass `--execution <path>` to
read another record, or a case index another tool exported as JSON. Whatever
names the case, Distill finds it in the record's case index and reads the
journals and the covered source by its id.

The command is deterministic. The same inputs produce the same ordering and
the same answer; it does not open a browser, run a test, or edit source.

## One record holds both readings

A run that records with [Sense](../packages/sense/README.md) and watches its
page with [Eyes](eyes.md) writes both readings into the same record, keyed by
the same case. Sense keys a case by its coordinate: the project-relative test
file, then the describe path and the test name, joined by ` > `.

```text
test/checkout.spec.ts > checkout > submits
```

That is the id `--test` takes. Distill looks it up exactly. It does not fall
back to a title or a file, because a title is not unique and a file contains
many cases, and a guessed match would put one test's attention beside another's
execution:

```text
The record holds no case with id checkout submits. No title or file join was guessed.
It records 214 case id(s), of which:
  test/checkout.spec.ts > checkout > submits
  ...
```

A case Playwright retried keeps a journal for every attempt, numbered from 1,
and Distill prints each one. An opportunity is a file no attempt addressed.

A record whose run did not use Eyes still answers what the case entered, and
reports that the attention half is missing:

```text
Distillation opportunities: unavailable; the record keeps no Eyes journals; the run did not opt into Eyes.
```

The journals stay in the record on the machine that ran the test. They leave it
only with the record: through `variance share`, or through a host cache the
config gives the suite to. Both name the journals among what they upload.

## Both readings name source from the same root

Eyes names a component's source relative to the repository root, the way Sense
names a covered module. A JSON index another tool exported may name its modules
from somewhere else; Distill brings the two to one shape against `--root`, which
defaults to the directory you run it in. When the root cannot reconcile them —
no addressed source file matches any covered module — you get no opportunity
list at all:

```text
Distillation opportunities: unavailable; none of the 1 addressed source file(s)
matched any of the 12 covered module(s) under root /path/to/project.
```

Comparing paths that disagree in shape would report every covered file as an
opportunity, including the component the test addressed, so the reading names
what it could not establish instead. Where only some addressed files fail to
match, the list stands and the leftovers are printed under **Addressed source
this run never covered**: usually a module nothing instrumented.

## The three readings

Eyes records the selectors, locators and events a test consumed while their DOM
targets were live. Each target has its React owner path and source location
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

Sense supplies the files covered by the exact same test id and their nearest
observed [depth](distance.md). Its [execution index](execution-record.md) is
whole-test evidence, not AAA evidence,
so distill does not assign those files to a phase. A covered file with no Eyes
target attributed to that file is a **distillation opportunity**.

```text
act:
  components: CheckoutForm
  source: src/checkout/form.tsx

React update initiators:
  act: 2 commit(s)
    inside addressed component paths: CheckoutForm
    outside addressed component paths: Clock

Runtime journey: 4 source file(s) covered by exact test id.
Covered with no addressed target attributed to the same file: 2.
  distillation opportunity at depth 0 — src/analytics.ts
  distillation opportunity at depth 0 — src/top-nav.tsx
```

Depth is whatever the producer of the execution index recorded. The Vitest
recorder in [Sense](../packages/sense/README.md) records every crossing at depth
0: it reports which regions a test covered, not how many calls deep the call
stack was when it covered them. The field shows a real number only from a
producer that tracks call depth, so read `depth 0` as "not recorded here" rather
than as "called directly".

An opportunity is not permission to mock, replace, or delete the file. [Static
reachability](source.md) describes what the test could load; execution records
what it covered; attention records what it addressed. None records what the test
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

A spy creates the same situation from the other side. `vi.spyOn(totals,
'formatTotal')` leaves the module loaded and its function unreached, and the
import statement above it still reads as a use.

Distill separates the two. Every covered module is read
[region by region](execution-record.md#blocks):
[`loadedOnly`](../packages/distill/README.md#api)
marks a module whose only crossings are the consequence of loading
it, and `unentered` names the declarations the test never reached.

```text
Loaded but not covered: 1 module(s).
  src/heavy-chart.tsx — the import ran its top level and this test covered nothing below it
    never covered: HeavyChart (lines 5-8)
    substitution to try: vi.mock('src/heavy-chart.tsx') — jest.mock and sb.mock say the same thing
```

This is a stronger reading than an opportunity and still not a verdict. Mocking
takes the module's top level with the rest, and a top level that registers a
handler, installs a polyfill, or builds a singleton is one the test may depend
on. Write the mock, rerun the exact test, and compare the witness before you
keep it.

## Imports a file loads for few of its cases

A runner evaluates a test file's imports once, when it loads the file, before
its first case. That cost belongs to the file, not to any one case, and it is
paid whether or not a case uses what was loaded. A dialog that opens on a click
loads its whole tree with the file, even when no case clicks. Name the file
alone to see that cost; the output opens with:

```bash
variance distill --file test/dialog.test.tsx
```

```text
test/dialog.test.tsx: 3 case(s); 4 loaded module(s) declare functions.

Loaded, and entered by no case: 2 module(s), 960 line(s).
  src/dialog.tsx imports src/heavy-editor.ts: 1 module(s), 900 line(s)
    src/heavy-editor.ts — 900 line(s)
  src/dialog.tsx imports src/fancy-error.tsx: 1 module(s), 60 line(s)
    src/fancy-error.tsx — 60 line(s)

Loaded, and entered by some cases only: 1 module(s), 40 line(s).
  src/confirm-dialog.tsx — 40 line(s), entered by 1 of 3 case(s)
```

Each module no case entered is listed under the import that made the file load
it: the topmost import every path from the test file to the module runs
through, with nothing behind it that a case entered. Removing that import frees
everything listed under it. The import is often not in the test file: above,
the test imports the dialog, and the dialog imports the editor. The file graph
is read from the checkout and walks imports, re-exports, and dynamic imports
whose specifier is a quoted string. An import that is dynamic only reads as `lazily
imports`: what is listed under it was loaded when the import ran, not when the
file did. Two groups take what no one import accounts for:

- **No one import brings these in alone.** Two imports reach the module, or the
  only one that does also brings in code a case entered. The line names the
  nearest file every path to the module runs through, which is where to look.
- **No import the graph reads reaches these from the test file.** An import
  or `require` whose specifier is not a quoted string, or the runner's own setup,
  brought the module in.

An import the record says the file never evaluated — a module mocked with a
factory — is not walked; an automocked module was evaluated, and is.

The text names the ten heaviest imports and the three largest modules under
each group, ten of those only some cases entered, and sums the rest on one line; `--format json` lists every module
with its cause.

A module listed is evidence; the fix is at its import. Delete that
import, or mock it with a factory, when nothing behind it is used; when part
of it is, import past the barrel inside its own package, or from an entry its
package declares; move it to the code that uses it when only some
cases do. Which case calls a module does not change what the file loads: only
the import graph does, through a lazy import or a file of its own. Mocking a listed module by its own path
ties the test to a file its code never names. An error boundary's fallback is
the usual example: imported by every case, rendered by none, because no error
happened.

The reading also holds the file's own mocks against the file graph, whatever
the record says. A mock of a module the file does not load, directly or through
anything it imports, is an error: it replaces nothing, so delete it. A mock of
a module more than two imports away, past what the file's subject imports, is a
warning that names the file importing it: the mock replaces an internal of
code the test never names. The distance is the shortest trail along the imports
a runtime evaluates; a type-only import loads nothing.

The reading counts a module only when it declares a function below its top
level. A barrel or a file of constants runs all it has when it loads, and a read
of a constant is not recorded, so the record cannot say the file did without it.
The reading needs the coverage rows of a recorded run, not a case index from
`--execution`. A record that keeps no cases for the file, a case that stopped
or did not say whether it finished, and an incomplete coverage row — a
filtered, cancelled or stopped run, or source changed since the run — each read
as unmeasured: an entry the run never got to is not an entry the file did
without. Running the file again records a row the reading can use.
As with every finding here, rerun the file after the change: a top level can
register something a case depends on.

## Imports a folder, a suite or the repository loads for nothing

One test file shows you what its own imports cost. The import worth removing
first is usually one many test files share: a barrel that puts a hundred unused
lines into forty test files costs four thousand, paid once in each. Name no case
and no file, and Distill reads every test file on its own, as `--file` would,
then gathers what each loaded for nothing under the import that brought it in:

```bash
variance distill --from packages/distill
```

```text
packages/distill in suite unit: 4 test file(s), each read.

Loaded, and entered by no case of the test file that loaded it: 63 module load(s), 12748 line(s).
  packages/distill/src/own.ts imports packages/core/src/relate/index.ts: 11 module(s) in 2 test file(s), 4540 line(s)
  packages/core/src/relate/index.ts imports packages/core/src/relate/merkle.ts: 4 module(s) in 2 test file(s), 1490 line(s)
  ...
  No one import brings these in alone: 7 module(s) in 4 test file(s), 3797 line(s)
```

An import's lines count once in every test file it reaches, because each file
evaluates its imports anew. Only what no case of the loading file entered is
gathered; a module some cases used belongs to the file's own reading. The text
names the ten heaviest imports and sums the rest, then the modules no one import
brings in alone and those no static import reaches, as a file's reading names
them ([above](#imports-a-file-loads-for-few-of-its-cases)); `--format json`
lists every import with its modules and the test files it reaches. Lines are
the size of what loaded, not its time. The fix is at the import named, as it
is for one file, and every test file the import reaches stops paying.

You choose the scope:

- **`--from <dir>`** reads the test files under a directory spelled from the
  repository root: a folder or a package.
- **`--suite <name>`** alone reads every test file of one suite.
- **Nothing** reads every test file of every declared suite, and names a
  declared suite that has not recorded. On a small project that is one answer
  for the whole suite; on a large one, start from a package.

A test file the record cannot answer for — no cases kept, a case that stopped,
an incomplete coverage row — is withheld and named, as it would be read alone.
A record of a filtered run withholds most of its files; the full run your
mainline records answers for all of them. Read one of the test files with
`--file` for the modules under each import, and for those only some of its
cases used.

## One capability, three entrances

| Entrance | Use it when | Invocation |
| --- | --- | --- |
| CLI | the run recorded in this checkout, or a record you name | `variance distill [--file <path> [--test <title>] \| --test <title> \| --from <dir>] [--suite <name> \| --execution <path>]` |
| [MCP](agent-questions.md#distill-one-test) | a producer already supplies Eyes and Sense evidence to a connection | `variance_distill {"test":"<id>"}` |
| [`variance-authority` skill](../packages/cli#ask-the-agent-answers-without-an-agent-protocol) | an agent must turn opportunities into a smaller verified test | install the skill shipped by `@variance-authority/cli` |

The CLI and MCP tool call the same analyzer and text formatter. `--format json`
exposes the analyzer result for another deterministic consumer. The skill adds
judgment; it does not replace the reading.

## The agent loop

For each opportunity, the agent identifies the narrowest reversible
substitution, changes one boundary, and reruns the exact test. It compares the
new attention and execution witness with the original before keeping the edit.
If an assertion loses its causal path, an addressed target disappears, or an
outside update initiator touches the retained surface, the substitution is
reverted or the test is adjusted to state the behavior it actually owns.

This is where mocking becomes justified: by a counterfactual run, not by an
unused percentage. Distill supplies the ordered work list and the evidence to
compare; the agent verifies each proposed boundary.

## Tests without Fiber

Distill does not require [React's Fiber tree](framework.md). A plain unit test or
a test over a fake component can supply only an execution index and still receive
a covered-source reading.
Without Eyes, the covered-versus-addressed opportunity comparison is unavailable.
With a complete empty Eyes journal, the addressed surface is measured empty and
the comparison can proceed. Neither case is printed as zero Fiber usage.

The current reading counts addressed target paths and covered files. It does
not report a percentage of the Fiber tree: unmounted, hidden, lazy and
never-observed branches have different denominators, and a DOM target does not
establish that every ancestor or descendant participates in the assertion.

Distill also does not decide whether the suite should retain several tests that
protect the same promise. It finds a smaller boundary for one test; [on
testing](on-testing.md#size-and-scope-are-different-decisions) explains why a
cheaper test may still be valuable, redundant or temporary. That is a portfolio
decision across tests, assertions and risk; [own fewer
tests](own-fewer-tests.md) describes the questions the execution evidence can
inform without turning overlap into a deletion verdict.
