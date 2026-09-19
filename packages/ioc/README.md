<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/ioc

> Wiring a test run drives and a production build ignores: declare how a module resets its own state, and let the runner decide when.

Part of [Variance Authority](https://variance-authority.dev).

A module-level `let` outlives the test that changed it. A counter, a cache, a
lazily built client, a memoized value — each one is written by whichever test
got there first and read by every test after, so a suite that passes in the
order you wrote it fails in another one, and the failure names the second test
rather than the one that did the writing.

The usual answers both cost something. Rebuilding the world between tests pays
setup on every test and throws away the evidence that would have identified the
leak. Reading a module's internals from a test file makes the test know things
the module never promised.

This package inverts that: the module that owns the state says how to reset it,
and the runner says when.

```bash
npm install --save-dev @variance-authority/ioc
```

## Requirements

Node 22 or newer, and an ESM project. The package declares no dependencies and
no peers.

## Declare the reset where the state lives

`registerResetHandler` goes beside the state, at module scope, in the module
that owns it:

```ts
import { registerResetHandler } from '@variance-authority/ioc/reset';

let counter = 0;

registerResetHandler(() => {
  counter = 0;
});

export const next = () => (counter += 1);
```

Nothing happens yet. The handler is enrolled only when a test setup has
installed a driver, and a shipped application never installs one — so this call
costs a boolean comparison and the handler is never run. What the package keeps
without a driver is a count, and the first handler it had to turn away, so that
a setup file loaded too late can be told which module already asked.

Write the handler so that running it twice is the same as running it once. It
assigns a known value rather than stepping a state machine, which is what lets
the package honour a second setup instead of guessing that it is a duplicate.

## Install the driver in the test setup

```bash
npm install --save-dev @variance-authority/ioc vitest
```

```ts
// vitest.setup.reset.ts
import { beforeEach } from 'vitest';
import { configureResetHandler } from '@variance-authority/ioc/reset/setup';

configureResetHandler(beforeEach);
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { setupFiles: ['./vitest.setup.reset.ts'] },
});
```

Hand it the runner's own per-test hook. `configureResetHandler` types that
argument as the shape Vitest, Jest, Mocha and Playwright hooks share and imports
none of them, so Jest and Mocha take the same call from their own setup file.
Playwright is the one that needs a different shape around it, below.

`beforeEach`, not `afterEach`. A failing test does run its `afterEach`; that is
the hook's contract. Resetting on the way in instead keeps the state a failure
left behind available to the reporter, rather than erasing it between the failure
and the report — and it does not depend on the previous test having finished, so
a worker that died on an unhandled rejection cannot leave the next file dirty.

The setup file has to run before any application module, because a handler
registers when its module is imported. Make it the first entry in `setupFiles`,
or the first import of a Playwright fixture. Get it wrong and you are told:

```
@variance-authority/ioc/reset: 1 handler(s) registered before this setup ran,
and they are not installed. The first was — () => { counter = 0; }

A handler registers when its module is imported, so a module imported before
this call has already asked and been refused. Move the import of this setup file
above every application module: in Vitest and Jest, make it the first entry in
setupFiles; in Playwright, the first import of the fixture file.
```

The count is how many asked early; the text after the dash is the first of them,
so you can find the module. It is the handler's source, with the handler's name
in front of it when it has one — a `function resetCounter() {}` declaration, or
an arrow assigned to a `const`. The arrow above was passed straight into the
call, so it has no name and only its source is printed. Name the handler if you
want the message to name it.

That check is unconditional and has no opt-out. A handler that registered early
is not installed, and a suite that silently does not reset is the failure this
package removes.

### Playwright

Playwright has no `setupFiles`, and a `test.beforeEach` call attaches to the
spec file that is loading when it runs — so a module that calls it is imported
once and covers only the first spec file. Install the driver on an automatic
fixture instead, and export the `test` your specs import:

```bash
npm install --save-dev @variance-authority/ioc @playwright/test
```

```ts
// reset.fixture.ts
import { test as base } from '@playwright/test';
import { configureResetHandler } from '@variance-authority/ioc/reset/setup';

let resetModules = (): void => {};

configureResetHandler((run) => {
  resetModules = run;
});

export const test = base.extend<{ moduleState: void }>({
  moduleState: [
    async ({}, use) => {
      resetModules();
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
```

`configureResetHandler` hands the driver to whatever you pass; keeping it in a
variable and calling it from an automatic fixture runs it before every test in
every spec file, which is what the runner's own hook cannot do from here.

```ts
// tests/counter.spec.ts
import { expect, test } from '../reset.fixture.js';
import { next } from '../counter.js';

test('leaves the counter at two', () => {
  expect(next()).toBe(1);
  expect(next()).toBe(2);
});

test('starts from zero again', () => {
  expect(next()).toBe(1);
});
```

The fixture import goes above the import of any application module: `counter.ts`
registers its handler when it is imported, and imports run in source order.

## What it does not cover

Between *files*, not much: a module that reads state while it is being imported
runs before any hook and sees whatever the previous file left.

Into somebody else's package, nothing. A memoized value inside a dependency you
do not author has no place to put a handler, and the answer there is to observe
the coupling rather than to clear it — `npx variance run` reads a changed
subject (one named UI state you asked for and can ask for again) twice and names
both the component that changed and the band it changed in: the kind of thing
that changed, such as text, geometry or accessible name.

## Why the gate is the driver and not the build mode

`NODE_ENV === 'production'` looks like the right condition and is the wrong
question. A static Storybook build **is** a production build, and it is exactly
where a collector runs a suite, so that gate would switch the resets off in the
one environment that needs them most. Whether a driver was installed is a fact
about this run; which mode the bundle was built in is not the same fact.

The registry lives on `globalThis` under a well-known symbol rather than in
module scope, because the question *has a setup installed a driver?* has to be
answerable from the copy of this module that your application imported.
`jest.resetModules()` empties the module registry, a dual CJS/ESM resolution
hands the setup file and the application two instances, and a runner that builds
a fresh module graph per file does the same again. A module-scoped flag reads
`false` in all three, in a suite that is configured correctly.

## Reference

| Entry point | Export | |
|---|---|---|
| `@variance-authority/ioc/reset` | `registerResetHandler(handler)` | Records a reset; returns a function that unregisters it. Inert until a driver exists. |
| `@variance-authority/ioc/reset/setup` | `configureResetHandler(each)` | Installs the driver on a per-test hook. Throws if a handler registered first. |

One handler that throws does not stop the others: every handler runs, and the
failures are reported together. Skipping the rest would leave exactly the
order-dependent state the reset was for.

## License

MIT © Machine Garden

---

**[@variance-authority/ioc](https://variance-authority.dev/reference/packages/ioc)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
