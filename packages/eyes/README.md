<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/eyes

> Record which DOM elements a test addresses and preserve their React attribution before the rendered tree changes under it.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

Your test suite reports that assertions passed. It does not show which of
the rendered UI each test actually used. A checkout test renders a nav bar, a
clock and an order form; only some of that is the behaviour the test protects.

Eyes records, per test and in order, every element your test queried, clicked,
read or asserted on, together with the React component that rendered it — and it
copies that attribution at the moment the element is addressed, so an element
removed by its own click handler is still attributable afterwards. In a
Playwright run that records with
[`@variance-authority/playwright-test`](https://variance-authority.dev/reference/packages/playwright-test),
each test's journal goes into that run's record, beside what the test executed.

With that record you can:

- Read back one test's addressed surface: `variance distill --test '<case id>'`.
  The same command names the files the test loaded without addressing anything
  in them — candidates for a stand-in. [Distil a test](https://variance-authority.dev/docs/distill) is the
  loop that confirms them.
- Ask an agent to replay one test's selectors, events and Arrange/Act/Assert
  boundaries in order, through the `variance_test_attention` MCP tool that
  `serveEyesRecord` from `@variance-authority/mcp` serves over that record.

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

**3. Watch `screen` for the span of each test.** `watchTest(screen)` opens one
log for the test, and its `close` returns the journal and hands it to the case
the run is recording, where the recording seam's case takes one. The case names
the journal, by the id and the attempt the record joins on, so there is no id
for you to build:

```ts
// vitest.setup.eyes.ts
import { screen } from '@testing-library/react';
import { watchTest } from '@variance-authority/eyes/rtl';
import { afterEach, beforeEach } from 'vitest';

let attention: ReturnType<typeof watchTest>;

beforeEach(() => {
  attention = watchTest(screen);
});

afterEach(() => {
  attention.close();
});
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.eyes-hook.ts', './vitest.setup.eyes.ts'],
  },
});
```

Under Vitest, Jest and Rstest, the recording seam holds each attempt's case
from before its first `beforeEach` until its last `afterEach`, so a journal
closed in teardown lands under that case and attempt, and a retried case keeps
every attempt. The journal `close` returns is still yours to read in the same hook.

A harness that keeps its own journals passes `watchTest` an identity, `{ id,
title, file }`, and `close` then returns a journal carrying it and hands it to
no case.

### What you get

One test that rendered a button, queried it by role, and clicked it, where the
click handler removed the button. The journal, abridged:

```json
{
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
```

The `document-event` entry above is abridged: every target uses the same
`provenance` shape as the query target, and a real pointer produces the
`pointerdown`, `pointerup` and `focusin` around the click as well. A
`react-commit` entry names the components that performed render work and the
structural paths of the live components that initiated the update. A source
path in an entry is relative to the repository root, the way Sense names a
covered module.

`complete` is derived rather than asserted. `createEyesLog` numbers entries from
construction and `drain` does not reset that counter, so a journal starting above
zero or skipping a number is missing entries an earlier drain took; the journal
is then marked partial and records how many. A caller that has its own reason
for stopping collection passes it to `close`, and that reason wins.

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

### Read it in a test's story

When the test runs with `VARIANCE_AUTHORITY_STORY` set, each entry Eyes records
is also written into the test's
[story](https://variance-authority.dev/docs/test-stories) as one line, under the
step where it happened:

```text
  3  SaveBar/onSave  save-bar.tsx:12-30
       » eyes act
       » eyes getByRole("button", {"name":"Save"}) → button "Save" in SaveBar
       » eyes click (synthetic) on button "Save" in SaveBar
       » eyes commit SaveBar, Toast
```

So the story shows which arguments a query was called with and what it found,
beside the code that ran, and you do not work them out from the route. When you
compare the runs of a test that fails on some of them, a query whose result is
different on every failing run, or an event that fires before a function on
every failing run and after it on every passing one, is listed by itself. This
works under Vitest, Jest and Rstest in the realm the test runs in; a Playwright
test's story is not recorded.

## Record a Playwright run

**1. Install.**

```bash
npm install --save-dev @variance-authority/eyes @playwright/test
npx playwright install chromium
```

**2. Wrap the config in `withTestSelection`** from
[`@variance-authority/playwright-test`](https://variance-authority.dev/reference/packages/playwright-test),
which records what each test executed into the run's record.

**3. Compose `eyesFixtures` after the recording's fixtures** in the extension
module your suite already owns. Here `recorded` is your `test` already extended
with `varianceFixtures` from `@variance-authority/playwright-test`. The `eyes`
fixture opens a journal for each test and, when the test is over, hands it to
the case the run is recording:

```ts
// tests/fixtures.ts
import { eyesFixtures } from '@variance-authority/eyes/playwright';
import { test as recorded } from './recorded';

export const test = recorded.extend(eyesFixtures);
```

The record keeps the journal under the case's id — its file relative to the
repository root, then its describe path and name — and under its attempt. A run
that does not record has no case to hand a journal to, and the journal stays
yours to drain from `eyes` in your own teardown.

The fixture overrides `page` with an API-compatible proxy that preserves Locator
chaining and records action, read and assertion consumption, and it installs the
browser agent as an init script, so the React commit tap is in place before page
code loads — the Playwright path needs no equivalent of the RTL hook step.

`parseEyesJournal` from `@variance-authority/eyes/archive` validates a journal
before it crosses a process boundary. `bundleEyesAgent` is exported for custom
fixture authors; the standard fixture reads and installs that same bundle.

## One journal per attempt

A retry is a second attempt, not a second test. The record numbers attempts
from 1, so Playwright's `testInfo.retry` of `0` is attempt 1, and a retried test
keeps one journal per attempt under one case id. The attempt is a column of the
record and never part of the id: an id with the attempt spelled into it would
join to nothing.

## Where the journal goes

The journal stays in the record on the machine that ran the test. It leaves only
with the record: through `variance share`, or through a host cache the config
gives the suite to. Each names the journals among what it uploads.

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
