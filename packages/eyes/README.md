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
import { eyesFixtures } from '@variance-authority/eyes/playwright';

const test = base.extend(eyesFixtures);

test.afterEach(async ({ eyes }, testInfo) => {
  await testInfo.attach('eyes.json', {
    body: Buffer.from(JSON.stringify(eyes.drain())),
    contentType: 'application/json',
  });
});
```

The low-level `bundleEyesAgent` export is for custom fixture authors. The
standard fixture reads and installs that same bundle.

## Capture one node directly

The root entrypoint has no runner integration. `snapshotNode` copies one DOM
node's stable identity and React provenance synchronously; `createEyesLog`
creates the ordered in-memory journal both adapters use:

```ts
import { createEyesLog, snapshotNode } from '@variance-authority/eyes';

const log = createEyesLog();
const target = snapshotNode(document.querySelector('button')!);
```
