<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/eyes

> Record which DOM elements a test addresses and preserve their React attribution before the rendered tree changes under it.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

Your test suite tells you that assertions passed. It does not tell you which of
the rendered UI each test actually used. A checkout test renders a nav bar, a
clock and an order form; only some of that is the behaviour the test protects.

Eyes records, per test and in order, every element your test queried, clicked,
read or asserted on, together with the React component that rendered it — and it
copies that attribution at the moment the element is addressed, so an element
removed by its own click handler is still attributable afterwards. It writes the
result to a JSON file.

With that file you can:

- Read back one test's addressed surface:
  `variance distill --test '<id>' --eyes .variance/eyes.json`. Pair it with
  execution evidence from `@variance-authority/sense` and the same command names
  the files the test loaded without addressing anything in them — candidates for
  a stand-in. [Distil a test](https://variance-authority.dev/docs/distill) is the
  loop that confirms them.
- Ask an agent to replay one test's selectors, events and Arrange/Act/Assert
  boundaries in order, through the `variance_test_attention` MCP tool in
  `@variance-authority/mcp`.

The evidence model, and what Eyes refuses to conclude from it, is
**[Eyes: what a test actually witnesses](https://variance-authority.dev/docs/eyes)**.

Eyes is additive. It exports no `test` and no `expect`, replaces no runner
configuration or lifecycle, and installing it installs neither React Testing
Library nor Playwright.

## Requirements

Node 22 or newer. The runner packages are optional peers, so install the one
your suite uses:

| Peer | Range |
| --- | --- |
| `@testing-library/react` | `>=16.3 <17` |
| `@testing-library/dom` | `>=10.4 <11` |
| `@playwright/test` | `>=1.62 <2` |

Eyes reads React through the `__REACT_DEVTOOLS_GLOBAL_HOOK__` global rather than
importing your React, and its own suite runs against React 19.

## Record a React Testing Library run

Four steps, in this order.

**1. Install.**

```bash
npm install --save-dev @variance-authority/eyes @testing-library/react
```

**2. Install the React commit hook — you install it, Eyes does not.** `watch`
attaches to a hook that already exists and never creates one, because by the
time a test file imports `screen`, `react-dom` has already run its module body
and bound whatever hook it found. Creating one then would attach to an object
React never calls. So call `tapCommits()` yourself, in a setup file that runs before anything imports `react-dom`:

```ts
// vitest.setup.eyes-hook.ts
import { tapCommits } from '@variance-authority/eyes';

tapCommits();
```

Keep this in its own file and import nothing from Testing Library in it: a
module's imports are evaluated before its own statements, so a file that
imports `@testing-library/react` loads `react-dom` before its first line runs.
Skip this step and everything below still works — every journal then records a
`react-tap-refused` entry with the reason, rather than looking like a page that
rendered nothing.

**3. Watch `screen` for the span of each test and publish the journal.**
`watchTest` pairs one log with the test identity you give it; its `close`
returns the journal that `recordEyesTest` writes to disk.

The id below is the test's **coordinate** — its project-relative file, then its
describe path and name, joined by ` > `. That is the id
[`@variance-authority/sense`](https://variance-authority.dev/reference/packages/sense)
gives the same case in its execution index, and `variance distill` joins the two
recordings on exact id and guesses nothing. Use the runner's own `task.id` and
the journal still archives, but nothing will join to it.

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

Two cases in one file may share the same coordinate. Sense numbers the repeat —
the second is `<coordinate>#1` — so give a deliberate duplicate a name of its
own rather than matching that suffix by hand.

**4. Clear the directory when the run starts, fold it when the run ends.** A run
spreads tests over worker processes, so no object in memory collects what the
run saw: each test publishes its own journal, and the archive is what folding
the directory produces. Journals are named by test id, so the directory must
belong to one run. `resetEyesJournals` goes in the runner's once-per-run hook,
never in a test file, where it races the other workers.

```ts
// vitest.globalSetup.eyes.ts
import {
  gatherEyesArchive,
  resetEyesJournals,
  writeEyesArchive,
} from '@variance-authority/eyes/collect';

export async function setup(): Promise<void> {
  await resetEyesJournals('.variance/eyes');
}

export async function teardown(): Promise<void> {
  await writeEyesArchive('.variance/eyes.json', await gatherEyesArchive('.variance/eyes'));
}
```

Wire all three files up, the hook file first:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globalSetup: ['./vitest.globalSetup.eyes.ts'],
    setupFiles: ['./vitest.setup.eyes-hook.ts', './vitest.setup.eyes.ts'],
  },
});
```

`gatherEyesArchive` throws on a missing directory rather than reporting an empty
archive: a run whose tests recorded nothing and a run that wrote its journals
somewhere else are different situations.

### What you get

`.variance/eyes.json`, abridged — one test that rendered a button, queried it by
role, and clicked it, where the click handler removed the button:

```json
{
  "eyesVersion": 1,
  "tests": [
    {
      "id": "collect.test.tsx > removes on click",
      "title": "removes on click",
      "file": "src/collect.test.tsx",
      "complete": true,
      "attention": [
        {
          "kind": "rtl-query",
          "query": "getByRole",
          "arguments": ["button", { "name": "Remove me" }],
          "outcome": "resolved",
          "targets": [
            {
              "nodeName": "button",
              "type": "button",
              "provenance": {
                "status": "resolved",
                "provenance": {
                  "owners": [{ "name": "SelfRemoving", "propsDigest": "b5c1f0a2" }]
                }
              }
            }
          ],
          "sequence": 0
        },
        {
          "kind": "document-event",
          "event": "click",
          "trusted": false,
          "target": { "nodeName": "button", "type": "button" },
          "sequence": 1
        }
      ]
    }
  ]
}
```

The `document-event` entry above is abridged: every target uses the same
`provenance` shape as the query target, and a real pointer produces the
`pointerdown`, `pointerup` and `focusin` around the click as well. A
`react-commit` entry names the components that performed render work and the
structural paths of the live components that initiated the update.

`complete` is derived rather than asserted. `createEyesLog` numbers entries from
construction and `drain` does not reset that counter, so a journal starting above
zero or skipping a number is missing entries an earlier drain took; the journal
is then marked partial and says how many. A caller that already knows why
collection stopped passes its own reason to `close`, and that reason wins.

### Mark the phases

Eyes records the Arrange, Act and Assert boundaries you declare and infers none
of them from library calls. This is an excerpt — `attention` is the value from
step 3, and `render`, `screen` and `expect` come from your suite:

```ts
attention.log.phase('arrange');
render(<DrawingPage />);
attention.log.phase('act');
screen.getByRole('button', { name: 'Redraw' }).click();
attention.log.phase('assert');
expect(screen.getByRole('status')).toHaveTextContent('Redrawn');
```

### What the RTL entry point covers

`watchTest` and `watch` mutate the supplied `screen` object in place, so later
imports of that same object are observed. Queries returned by `render()` and by
`within()` are different bound objects and stay outside it.

Watching also installs capture-phase listeners on the runner's document, which is
how a click on an element the handler then removes is recorded with the
attribution it had when the event fired.

Where you want a subscription with no notion of a test — reading
`attention.log.seen`, or taking entries with `attention.log.drain()` yourself —
`watch(screen)` is that, and `attention.close()` restores every method once no
watcher remains.

## Record a Playwright run

**1. Install.**

```bash
npm install --save-dev @variance-authority/eyes @playwright/test
npx playwright install chromium
```

**2. Compose `eyesFixtures` into the extension module your suite already owns,
and publish each test's journal.** The `eyes` fixture opens a journal; closing
and publishing it is yours to do, and the `afterEach` below is what does it.

```ts
// tests/fixtures.ts
import { test as base, expect } from '@playwright/test';
import { eyesTestAttention } from '@variance-authority/eyes';
import { recordEyesTest } from '@variance-authority/eyes/collect';
import { eyesFixtures } from '@variance-authority/eyes/playwright';

export const test = base.extend(eyesFixtures);
export { expect };

test.afterEach(async ({ eyes }, testInfo) => {
  await recordEyesTest(
    '.variance/eyes',
    eyesTestAttention(
      { id: testInfo.testId, title: testInfo.title, file: testInfo.file },
      eyes.drain(),
    ),
  );
});
```

**3. Clear and fold once per run**, exactly as in step 4 above, from
`globalSetup` and `globalTeardown` in `playwright.config.ts`:

```ts
// playwright.eyes-setup.ts
import { resetEyesJournals } from '@variance-authority/eyes/collect';

export default async function globalSetup(): Promise<void> {
  await resetEyesJournals('.variance/eyes');
}
```

```ts
// playwright.eyes-teardown.ts
import { gatherEyesArchive, writeEyesArchive } from '@variance-authority/eyes/collect';

export default async function globalTeardown(): Promise<void> {
  await writeEyesArchive('.variance/eyes.json', await gatherEyesArchive('.variance/eyes'));
}
```

The fixture overrides `page` with an API-compatible proxy that preserves Locator
chaining and records action, read and assertion consumption, and it installs the
browser agent as an init script, so the React commit tap is in place before page
code loads — the Playwright path needs no equivalent of the RTL hook step.

To attach the journal to the Playwright report instead of the shared directory,
build a one-test archive with `createEyesArchive` and hand it to
`testInfo.attach`. `readEyesArchive` from `@variance-authority/eyes/archive`
validates either artifact before it crosses a process boundary, and the same
validation runs on every journal on the way in, so a run that produced something
a reader would refuse fails where it was written.

`bundleEyesAgent` is exported for custom fixture authors; the standard fixture
reads and installs that same bundle.

## One journal per test id, enforced

`recordEyesTest` publishes with `link`, so a second journal under a test id
throws rather than replacing the first — a duplicate id makes the earlier test
invisible to the archive while every process reports success.

The consequence to plan for: a test id is stable across retries, so a retried
test throws in its own teardown when it tries to publish a second time. Run with
retries disabled, or give `recordEyesTest` an id that includes the attempt.

An id has two jobs, and the second is easy to miss: it must be unique within one
run, and — where the journal will be read beside a Sense execution index — it
must be the coordinate Sense keys the same case by. Adding an attempt number
satisfies the first and breaks the second.

`EYES_JOURNAL_SUFFIX` (`.va-eyes.json`) is what tells a journal apart from
anything else in the directory; `resetEyesJournals` deletes only files whose
name ends with it.

`@variance-authority/eyes/collect` is a separate entrypoint because it imports
`node:fs`, while `/rtl` is imported by test files a bundler may follow into a
browser.

## Capture one node directly

The root entrypoint has no runner integration. `snapshotNode` copies one DOM
node's stable identity and React provenance synchronously — React deletes its
Fiber expando on unmount, so retaining the node and calling this later is not the
same operation. `createEyesLog` creates the ordered in-memory journal both
adapters use:

```ts
import { createEyesLog, snapshotNode } from '@variance-authority/eyes';

const log = createEyesLog();
log.phase('arrange');
const target = snapshotNode(document.querySelector('button')!);
```

---

**[@variance-authority/eyes](https://variance-authority.dev/reference/packages/eyes)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
