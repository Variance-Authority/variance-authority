<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/distill

> Find the code one test loads but never uses, and get a concrete substitution to try.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

A checkout test renders your whole app — `App`, `TopNav`, `Clock`, an analytics
module, and the `CheckoutForm` it came for. It passes. It does not show
which of that it needed.

`distill` answers that by subtraction. One recording lists what the test's
execution loaded and ran. A second lists which elements the test deliberately
queried, clicked, read or asserted on — the elements it *addressed*. Everything
in the first that is missing from the second is what is worth trying to remove:

```text
what the run loaded and ran  −  what the test demonstrably interacts with
= the boundary this test may not need
```

You get an ordered list of files. For a file whose import ran but whose
functions never did, you also get the substitution to try, spelled out:
`vi.mock('src/heavy-chart.tsx')`.

`distill` reads files and prints. It does not open a browser, run a test, or
edit your source, and it reads no project configuration. Rerunning the test
after you make a substitution is what settles whether the boundary can go.

## Install

```bash
npm install --save-dev @variance-authority/distill
```

For the command line instead of the API, install the CLI, which calls the same
analyzer and printer:

```bash
npm install --save-dev @variance-authority/cli
```

## The record you need first

`distill` reads one file, the record your own test run writes. It does not come
from `distill`, and it does not come from `variance run`. The record holds two
readings of each case.

**The case index** — which files and which functions inside them each test
covered, meaning ran code in rather than merely imported. Install
[`@variance-authority/sense`](https://variance-authority.dev/reference/packages/sense)
and wrap your Vitest config:

```bash
npm install --save-dev @variance-authority/sense
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';

export default withTestSelection(
  defineConfig({ test: { include: ['src/**/*.test.ts'] } }),
);
```

Every wrapped run writes the per-case recording into its record,
`coverage.bin`, and `distill` reads that record as it is. A test file that runs in a page is
recorded per file only, so a browser-mode run does not write the file `distill`
needs.

**The Eyes journals** — which elements each case addressed, and the React
component behind each one. In a Playwright suite wrapped in `withTestSelection`,
install [`@variance-authority/eyes`](https://variance-authority.dev/reference/packages/eyes)
and extend `test` with its fixtures after the recording's own:

```bash
npm install --save-dev @variance-authority/eyes @variance-authority/react @variance-authority/playwright-test
```

```ts
// test/fixtures.ts
import { test as base } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';
import { eyesFixtures } from '@variance-authority/eyes/playwright';

export const test = base.extend(varianceFixtures).extend(eyesFixtures);
```

Each attempt's journal lands in the record under the case that ran it. A case
Playwright retried keeps one journal per attempt, numbered from 1, and the
attempt is never part of the case id.

### One id joins the two readings

`distill` joins the two readings on **exact case id** and guesses nothing — not
by title, not by file. Sense keys a case by its coordinate: the
repository-relative test file, then the describe path and the test name, joined
by ` > `.

```text
test/checkout.spec.ts > checkout > submits
```

The Eyes fixture takes its case from the recording, so both readings carry that
id without anything for you to build. An id the record does not hold is
refused, and the refusal lists some of the ids it does:

```text
The record holds no case with id checkout submits. No title or file join was guessed.
```

### Arrange, Act and Assert are read, not guessed

`distill` reports the addressed elements phase by phase because your test marks
where the phases are. Eyes records the boundaries you declare and infers none
of them from a library call or an API name. This is an excerpt — `attention` is
the value Eyes' `watchTest` returns for the current test, and `render`, `screen`
and `expect` come from your own suite:

```ts
attention.log.phase('arrange');
render(<Checkout />);
attention.log.phase('act');
screen.getByRole('button', { name: 'Place order' }).click();
attention.log.phase('assert');
expect(screen.getByRole('status')).toHaveTextContent('Order placed');
```

A test with no phase markers still works. Its observations are reported under
`unphased`.

## Run it

From the command line, in the checkout that ran the test, naming the case and
the file that declares it:

```bash
variance distill --file test/checkout.spec.ts --test submits
```

`--test` takes the case's id, its exact title, or a part of the title.
`--file` takes any part of the test file's path. When more than one case fits,
the command prints their ids and stops, and you pass one of them to `--test`.
`--file` alone reads the whole file instead: the modules it loaded that no
case, or only some of its cases, entered, each module no case entered under the
import that made the file load it.

`distill` reads the record `covering` reads; `--suite <name>` picks one declared
suite's, and `--execution <path>` names another record, or a case index another
tool exported as JSON. Add `--format json` for the analyzer result instead of
the text.

From Node, `distill` takes the readings already in hand. Here a case index
another tool exported as JSON, and one journal for its only attempt:

```ts
import { readFile } from 'node:fs/promises';
import { parseEyesJournal } from '@variance-authority/eyes/archive';
import { distill, formatDistillation, parseExecutionIndex }
  from '@variance-authority/distill';

const test = 'test/checkout.spec.ts > checkout > submits';
const execution = parseExecutionIndex(
  JSON.parse(await readFile('execution.json', 'utf8')),
);
const journal = parseEyesJournal(JSON.parse(await readFile('journal.json', 'utf8')));

console.log(formatDistillation(distill({
  test,
  execution,
  eyes: [{ case: test, attempt: 1, journal }],
})));
```

`parseExecutionIndex` and `parseEyesJournal` validate untyped JSON at the
process boundary and throw naming the offending field. Pass an `ExecutionIndex`
you already have and it returns it unchanged.

## What you get

For a checkout test that set a quantity, clicked to place the order, and
rendered analytics and a chart it never touched — abridged, since the printed
text also closes with a substitution rule and an opportunity rule restating that
neither finding is permission to delete anything:

```text
checkout submits — test/checkout.test.tsx [test/checkout.test.tsx > checkout submits]
Eyes journal, attempt 1: complete.
2 target snapshot(s); 0 had no live React Fiber.

arrange:
  components: CheckoutForm
  source: src/checkout/form.tsx
act:
  components: CheckoutForm
  source: src/checkout/form.tsx

React update initiators:
  act: 1 commit(s)
    inside addressed component paths: CheckoutForm
    outside addressed component paths: Clock

Runtime phase attribution: unavailable; ExecutionIndex retains test crossings, not AAA intervals.
Runtime journey: 3 source file(s) covered by exact case id.
  depth 0 — src/analytics.ts
  depth 0 — src/checkout/form.tsx
  depth 0 — src/heavy-chart.tsx
Covered with no addressed target attributed to the same file: 2.
  distillation opportunity at depth 0 — src/analytics.ts
  distillation opportunity at depth 0 — src/heavy-chart.tsx

Loaded but not covered: 1 module(s).
  src/heavy-chart.tsx — the import ran its top level and this test covered nothing below it
    never covered: HeavyChart (lines 5-8)
    substitution to try: vi.mock('src/heavy-chart.tsx') — jest.mock and sb.mock say the same thing
```

Reading it:

- **The phase blocks** name what the test addressed, and where that markup came
  from in your source. Everything else the run touched is absent from them.
- **React update initiators** are the component instances whose state queues
  scheduled a commit. One outside the addressed paths — `Clock` here — means
  code the test did not address started work during the same authored phase.
  It names an instance, not the source statement that called a setter.
- **`Runtime phase attribution: unavailable`** is not a failure. The execution
  index records what each test covered across the whole test, not per phase, so
  covered files are never split across Arrange, Act and Assert.
- **`depth`** is a call depth from the test. Every entry the Vitest recorder
  writes sets it to `0`; the field exists for a recorder that measures one.
- **`sb.mock`** is Storybook's, from `storybook/test`. `vi.mock`, `jest.mock`
  and `sb.mock` are the three forms of the same substitution.
- **The two finding lines** are the two classes of answer, below.

## The two classes of finding

**A distillation opportunity** is a file the test covered with no addressed
element attributed to it. The test ran code in that file and never touched
anything the file rendered. That is a place to look, and not more: an
unaddressed component can still shape the result the assertion reads.

**Loaded but not covered** is the stronger reading. An import is not a use.
`import { HeavyChart } from './heavy-chart'` runs that module's top level, and
nothing else in it runs unless something calls in — the branch that would have
rendered it was never taken, or a spy answered in its place. Both leave one
trace: the module's top level ran, every declaration below it untouched. That is
the case `distill` names a substitution for.

Neither class is a verdict, and that is the position rather than a shortfall.
Mocking takes the top level with the rest, so a top level that registers a
handler, installs a polyfill, or builds a singleton is one the test is standing
on. Make the substitution, rerun that exact test, and compare the new reading
against this one before you keep the edit.

## Without Eyes journals

A record whose run did not use Eyes, or a JSON case index, still gives you the covered-source reading and
the loaded-but-not-covered finding, which is what makes a plain Node unit test
or a non-React harness worth distilling.

The opportunity comparison is then reported unavailable rather than empty. A
test whose attention was never recorded and a test that addressed nothing are
different situations, and `distill` will not print one as the other. A
complete Eyes journal that happens to be empty and the comparison proceeds with
a measured-empty addressed surface.

## API

| Export | What it is |
| --- | --- |
| `distill(input)` | `DistillInput` in, `Distillation` out. Throws when the execution index holds no case that fits `test` and `file`, or more than one. |
| `formatDistillation(result)` | The text above. The CLI and MCP adapters print exactly this. |
| `parseExecutionIndex(value)` | Validates untyped execution JSON, throwing on the first bad field. |
| `distillFile(input)` | `FileDistillInput` in, `FileDistillation` out: the modules one test file loaded that no case, or only some cases, entered. Throws when no recorded test file, or more than one, contains `file`. |
| `LoadCause` | Why a file loaded a module no case entered: the one `import` every path to it runs through, `shared` with the file where its paths part, or `unseen` by any static import. Set when `FileDistillInput.imports` gives the static imports of each file. |
| `formatFileDistillation(result)` | The text of a file reading, as the CLI prints it for `--file` alone. |
| `scopeRows(input)` | `ScopeDistillInput` in, one `ScopeRow` a test file out, as `variance distill --format jsonl` writes them: the file's `suite`, `cases`, what it `loaded` and its lines, and what no case of it `unentered`, or `withheld` with the reason. Throws when the scope holds no recorded test file. |

`DistillInput` names the case by `test`, `file`, or both — `file` alone when
the file holds one case — and carries the `execution` index, an optional `root`,
and optional `eyes`: one `EyesAttempt` per recorded attempt, each a `case`, an
`attempt` numbered from 1, and its `journal`. The case is found in the index
alone, and the journals are read by its id. `attempts` on the result carries
each attempt's attention. `Distillation` is a plain data result: `attention` is the per-phase
`AddressedPhase` and `UpdatePhase` records, and `execution` lists `EnteredFile`
by file and `EnteredModule` region by region. A `Region` is one instrumented
declaration — a module's top level, or a function — with its name and line
range. On an `EnteredModule`, `entered` and `unentered` split those regions, and
`loadedOnly` is the flag behind the loaded-but-not-covered finding.

`FileDistillInput` carries a part of the test file's path as `file`, the
record's case index as `execution`, and its coverage rows as `coverage`.
`FileDistillation` counts what the file `loaded` and their `lines`, and lists `LoadedModule` entries — `file`, `lines`, and
`entered`, how many of the file's cases entered the module — fewest entered
first, then most lines, then by path. `modules` is absent, and `withheld` says
why, when the index keeps no cases for the file, when a case stopped or did not
say whether it finished, or when the file's coverage row is incomplete.

Ordering is deterministic. The same record produces the same answer.

---

**[@variance-authority/distill](https://variance-authority.dev/reference/packages/distill)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
