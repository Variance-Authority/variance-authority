<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/ioc

> Wiring a test run drives and a production build ignores: declare how a module resets its own state, and let the runner decide when.

A module-level `let` outlives the test that changed it. A counter, a cache, a
lazily built client, a memoized value — each one is written by whichever test
got there first and read by every test after, so a suite that passes in the
order you wrote it fails in another one, and the failure names the second test
rather than the one that did the writing.

The usual answers both cost something. Rebuilding the world between tests pays
setup on every test and throws away the evidence that would have identified the
leak. Reaching into a module's internals from a test file makes the test know
things the module never promised.

This package inverts that: the module that owns the state says how to reset it,
and the runner says when.

```bash
npm install --save-dev @variance-authority/ioc
```

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

```ts
import { beforeEach } from 'vitest';
import { configureResetHandler } from '@variance-authority/ioc/reset/setup';

configureResetHandler(beforeEach);
```

Hand it the runner's own per-test hook — Vitest, Jest, Mocha and Playwright all
fit, because it takes the shape those hooks share and imports none of them.

`beforeEach`, not `afterEach`. A failing test does run its `afterEach`; that is
the hook's contract. Resetting on the way in instead keeps the state a failure
left behind available to the reporter, rather than erasing it between the failure
and the report — and it does not depend on the previous test having finished, so
a worker that died on an unhandled rejection cannot leave the next file dirty.

The setup file has to run before any application module, because a handler
registers when its module is imported. Make it the first entry in `setupFiles`,
or the first import of a Playwright fixture. Get it wrong and you are told:

```
@variance-authority/ioc/reset: 3 handler(s) registered before this setup ran,
and they are not installed. The first was — resetTheCounter: () => { counter = 0; }
```

That check is unconditional and has no opt-out. A handler that registered early
is not installed, and a suite that silently does not reset is the failure this
package removes.

## What it does not reach

Between *files*, not much: a module that reads state while it is being imported
runs before any hook and sees whatever the previous file left.

Into somebody else's package, nothing. A memoized value inside a dependency you
do not author has no place to put a handler, and the answer there is to observe
the coupling rather than to clear it — `variance run` reads a changed subject
twice and names the component and the band that moved.

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
