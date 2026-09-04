<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/eyes

> Record which DOM elements a test addresses and preserve their React attribution before the rendered tree moves.

Eyes adds attention evidence to the test surface its adopter already owns. It
exports neither a runner-owned `test` nor `expect`, and installing it does not
install React Testing Library or Playwright. The complete evidence model and its
boundaries are in [Eyes](../../docs/eyes.md).

## Watch RTL screen queries

Install Eyes beside the React Testing Library already used by the suite:

```bash
npm install --save-dev @variance-authority/eyes @testing-library/react
```

Call `watch` once from Jest `setupFilesAfterEnv`, Vitest `setupFiles`, or a test
file. It mutates the supplied `screen` object in place, so later imports of that
same object are observed:

```ts
import { screen } from '@testing-library/react';
import { watch } from '@variance-authority/eyes/rtl';

export const attention = watch(screen);
```

`attention.log.seen` reads the current journal and `attention.log.drain()` takes
its entries. `attention.close()` restores every method once no watcher remains.
The entrypoint watches bound `screen` queries; `within()` and queries returned by
`render()` are distinct objects and remain outside it.

Watching also installs capture-phase listeners on the runner's document, so an
element removed by its own click handler is recorded with the attribution it had
when the event reached it. React commits need the commit hook in place before
`react-dom` loads; `watch` attaches to one and installs none, and a watch that
finds no hook records `react-tap-refused` with the reason instead.

The test authors Arrange, Act, and Assert boundaries; Eyes records them without
guessing from library calls:

```text
attention.log.phase('arrange');
render(<DrawingPage />);
attention.log.phase('act');
screen.getByRole('button', { name: 'Redraw' }).click();
attention.log.phase('assert');
expect(screen.getByRole('status')).toHaveTextContent('Redrawn');
```

## Add Eyes to a Playwright extension

Install Eyes beside the runner and its browser binary:

```bash
npm install --save-dev @variance-authority/eyes @playwright/test
npx playwright install chromium
```

Compose the unbound `eyesFixtures` value into the extension module the suite
already owns:

```ts
import { test as base, expect } from '@playwright/test';
import { eyesFixtures } from '@variance-authority/eyes/playwright';

export const test = base.extend(eyesFixtures);
export { expect };
```

The fixture preserves Locator chaining, records action/read/assertion
consumption, and installs capture-phase document listeners before navigation.
Another fixture or an `afterEach` hook can read the per-test `eyes` journal:

```ts
import { test as base } from '@playwright/test';
import { createEyesArchive, eyesTestAttention } from '@variance-authority/eyes';
import { eyesFixtures } from '@variance-authority/eyes/playwright';

const test = base.extend(eyesFixtures);

test.afterEach(async ({ eyes }, testInfo) => {
  const archive = createEyesArchive([
    eyesTestAttention(
      { id: testInfo.testId, title: testInfo.title, file: testInfo.file },
      eyes.drain(),
    ),
  ]);
  await testInfo.attach('eyes.json', {
    body: Buffer.from(JSON.stringify(archive)),
    contentType: 'application/json',
  });
});
```

The archive preserves the runner's stable test identity, explicit completion,
and chronological attention for readers such as `@variance-authority/mcp`.
The browser agent also installs the React commit tap before page code loads.
Each commit records both components that performed render work and the
structural paths of the live components in `memoizedUpdaters` that initiated the
update. The commit belongs to the most recent authored phase in the same journal;
it does not infer an Act from the update.
`readEyesArchive` from `@variance-authority/eyes/archive` validates an attached
or consolidated JSON artifact before it crosses a process boundary.

The low-level `bundleEyesAgent` export is for custom fixture authors. The
standard fixture reads and installs that same bundle.

## Publish what a run recorded

`@variance-authority/eyes/collect` is the Node half. It is a separate entrypoint
because it imports `node:fs`, and `/rtl` is imported by test files a bundler may
follow into a browser.

A run spreads its tests over worker processes, so no object holds what the run
saw. Each test publishes its own journal and the archive is what folding the
directory produces once the run has ended. A journal is named by test id, so the
directory has to hold one run: call `resetEyesJournals` from the runner's
once-per-run hook — Vitest `globalSetup`, a Playwright setup project — and never
from a test file, where it races the other workers.

```ts
import { resetEyesJournals } from '@variance-authority/eyes/collect';

export async function setup(): Promise<void> {
  await resetEyesJournals('.variance/eyes');
}
```

`watchTest` pairs one log with the runner's identity for the span of one test,
and its `close` returns the journal `recordEyesTest` publishes:

```ts
import { screen } from '@testing-library/react';
import { recordEyesTest } from '@variance-authority/eyes/collect';
import { watchTest } from '@variance-authority/eyes/rtl';

let attention: ReturnType<typeof watchTest>;

beforeEach(({ task }) => {
  attention = watchTest(screen, { id: task.id, title: task.name, file: task.file?.name });
});

afterEach(async () => {
  await recordEyesTest('.variance/eyes', attention.close());
});
```

Completeness is derived, not asserted. `createEyesLog` numbers entries from
construction and `drain` does not reset that counter, so a journal starting
above zero or skipping a number is missing entries an earlier drain took —
`eyesTestAttention` marks that one partial and says how many. A caller that
already knows why collection stopped passes its own reason instead, and that
reason wins.

Publishing is a `link`, so a second journal under one test id fails the test
that wrote it rather than replacing the first. `EYES_JOURNAL_SUFFIX` is what
tells a journal apart from anything else the directory holds.

Fold the directory once, where the run ends, and write the file a reader is
pointed at:

```ts
import { gatherEyesArchive, writeEyesArchive } from '@variance-authority/eyes/collect';

export async function teardown(): Promise<void> {
  await writeEyesArchive('.variance/eyes.json', await gatherEyesArchive('.variance/eyes'));
}
```

Every journal is validated on the way in by the same reader that guards the
consolidated file, so a run that produced something a reader would refuse fails
where it was written rather than hours later.

## Capture one node directly

The root entrypoint has no runner integration. `snapshotNode` copies one DOM
node's stable identity and React provenance synchronously; `createEyesLog`
creates the ordered in-memory journal both adapters use:

```ts
import { createEyesLog, snapshotNode } from '@variance-authority/eyes';

const log = createEyesLog();
log.phase('arrange');
const target = snapshotNode(document.querySelector('button')!);
```
