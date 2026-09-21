<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/distill

> Find the code one test loads but never uses, and get a concrete substitution to try.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

A checkout test renders your whole app — `App`, `TopNav`, `Clock`, an analytics
module, and the `CheckoutForm` it came for. It passes. It does not tell you
which of that it needed.

`distill` answers that by subtraction. One recording says what the test's
execution loaded and ran. A second says which elements the test deliberately
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

## The two evidence files you need first

Neither file comes from `distill`, and neither comes from `variance run`. Your
own test run writes them.

**An execution index** — which files and which functions inside them each test
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
  { cases: true, executionFile: '.variance/execution.json' },
);
```

`cases: true` is what makes the recording per test case rather than per test
file. Without it the file `distill` needs is not written.

**An Eyes archive** — which elements each test addressed, and the React
component behind each one. Install
[`@variance-authority/eyes`](https://variance-authority.dev/reference/packages/eyes),
record a journal per test, and fold the directory once where the run ends:

```bash
npm install --save-dev @variance-authority/eyes @variance-authority/react @testing-library/react
```

```ts
// vitest.setup.eyes.ts
import { screen } from '@testing-library/react';
import { getNames } from '@vitest/runner/utils';
import { recordEyesTest } from '@variance-authority/eyes/collect';
import { watchTest } from '@variance-authority/eyes/rtl';
import { afterEach, beforeEach } from 'vitest';

let attention: ReturnType<typeof watchTest>;

beforeEach(({ task }) => {
  const file = task.file?.name ?? '';              // project-relative, as Sense records it
  const name = getNames(task).slice(1).join(' > '); // describe path, then the test name
  attention = watchTest(screen, { id: `${file} > ${name}`, title: task.name, file });
});

afterEach(async () => {
  await recordEyesTest('.variance/eyes', attention.close());
});
```

```ts
// vitest.globalSetup.eyes.ts
import { gatherEyesArchive, resetEyesJournals, writeEyesArchive }
  from '@variance-authority/eyes/collect';

export async function setup(): Promise<void> {
  await resetEyesJournals('.variance/eyes');
}

export async function teardown(): Promise<void> {
  await writeEyesArchive('.variance/eyes.json', await gatherEyesArchive('.variance/eyes'));
}
```

That is three of the four pieces Eyes needs; the React commit tap and the runner
wiring are in the
[Eyes README](https://variance-authority.dev/reference/packages/eyes).

### Both halves must use the same test id

`distill` joins the two files on **exact id** and guesses nothing — not by
title, not by file. So the id you hand `watchTest` is the one decision that
makes the two recordings one reading.

Sense keys a case by its coordinate: the project-relative test file, then the
describe path and the test name, joined by ` > `.

```text
test/checkout.test.tsx > checkout > submits
```

The `beforeEach` above builds that string, which is why it uses `getNames`
rather than the runner's `task.id`. A positional id such as `875862714_0` is
unique and archives fine; it simply matches nothing in the execution index, and
you get:

```text
Runtime journey: supplied, but it contains no test with exact id 875862714_0.
```

The refusal lists a few of the ids the index does contain, so the mismatch is
visible in the output rather than something to go and reconstruct.

### Arrange, Act and Assert are read, not guessed

`distill` reports the addressed elements phase by phase because your test says
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

From the command line, where `<recorded-test-id>` is an `id` from the `tests`
array of either evidence file:

```bash
variance distill \
  --test '<recorded-test-id>' \
  --eyes .variance/eyes.json \
  --execution .variance/execution.json
```

With an Eyes archive, `--test` also accepts a test title, or a title fragment
that matches exactly one test. Add `--format json` for the analyzer result
instead of the text.

From Node, reading the same two files:

```ts
import { readFile } from 'node:fs/promises';
import { readEyesArchive } from '@variance-authority/eyes/archive';
import { distill, formatDistillation, parseExecutionIndex }
  from '@variance-authority/distill';

const eyes = await readEyesArchive('.variance/eyes.json');
const execution = parseExecutionIndex(
  JSON.parse(await readFile('.variance/execution.json', 'utf8')),
);

console.log(formatDistillation(distill({ test: 'checkout submits', eyes, execution })));
```

`parseExecutionIndex` validates untyped JSON at the process boundary and throws
naming the offending field. Pass an `ExecutionIndex` you already have and it
returns it unchanged.

## What you get

For a checkout test that set a quantity, clicked to place the order, and
rendered analytics and a chart it never touched — abridged, since the printed
text also closes with a substitution rule and an opportunity rule restating that
neither finding is permission to delete anything:

```text
checkout submits — test/checkout.test.tsx [test/checkout.test.tsx > checkout submits]
Eyes journal: complete.
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
Runtime journey: 3 source file(s) entered by exact test id.
  depth 0 — src/analytics.ts
  depth 0 — src/checkout/form.tsx
  depth 0 — src/heavy-chart.tsx
Entered with no addressed target attributed to the same file: 2.
  distillation opportunity at depth 0 — src/analytics.ts
  distillation opportunity at depth 0 — src/heavy-chart.tsx

Loaded but not entered: 1 module(s).
  src/heavy-chart.tsx — the import ran its top level and this test entered nothing below it
    never entered: HeavyChart (lines 5-8)
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

## Without an Eyes archive

Supply only an execution index and you still get the covered-source reading and
the loaded-but-not-covered finding, which is what makes a plain Node unit test
or a non-React harness worth distilling.

The opportunity comparison is then reported unavailable rather than empty. A
test whose attention was never recorded and a test that addressed nothing are
different situations, and `distill` will not print one as the other. Supply a
complete Eyes journal that happens to be empty and the comparison proceeds with
a measured-empty addressed surface.

## API

| Export | What it is |
| --- | --- |
| `distill(input)` | `DistillInput` in, `Distillation` out. Throws when no supplied evidence contains the named test, or when a title fragment matches more than one. |
| `formatDistillation(result)` | The text above. The CLI and MCP adapters print exactly this. |
| `parseExecutionIndex(value)` | Validates untyped execution JSON, throwing on the first bad field. |

`DistillInput` is made of `test` plus an optional `eyes` archive and `execution`
index. `Distillation` is a plain data result: `attention` is the per-phase
`AddressedPhase` and `UpdatePhase` records, and `execution` lists `EnteredFile`
by file and `EnteredModule` region by region. A `Region` is one instrumented
declaration — a module's top level, or a function — with its name and line
range. On an `EnteredModule`, `entered` and `unentered` split those regions, and
`loadedOnly` is the flag behind the loaded-but-not-covered finding.

Ordering is deterministic. The same two files produce the same answer.

---

**[@variance-authority/distill](https://variance-authority.dev/reference/packages/distill)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
