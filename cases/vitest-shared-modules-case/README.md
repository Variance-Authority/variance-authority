# Shared modules under Vitest

`isolate: false` makes a Vitest suite fast because a worker evaluates each
module once and keeps it for every file after. It also keeps what those modules
hold: a `let` one file changed, a `Set` it filled. This case runs Vitest 5's
real CLI over two identical test files in one worker and shows which of that
state [`@variance-authority/ioc`](../../packages/ioc) and
[`@variance-authority/isolator`](../../packages/isolator) give back to each test.

## The files

```
fixture/vitest.config.ts               one worker, isolate: false, and what resets state read from FIXTURE_RESETS
fixture/counter.ts                     a `let` and a `Set` no handler resets; logs each evaluation to FIXTURE_LOADS
fixture/tally.ts                       a `let` its module resets with registerResetHandler
fixture/reset.setup.ts                 ioc's driver on beforeEach, run again by Vitest for every file
fixture/one.case.ts, two.case.ts       the same three tests: count from one, again, tally from zero
fixture-split/vitest.config.ts         the isolator README's config: a shared project and an isolated one
fixture-split/src/b.mocked.case.ts     mocks a module that src/a.case.ts, run first, loads through src/reader.ts
src/resets.integration.test.ts         the outer test: runs each fixture and reads Vitest's JSON report
```

Both fixtures load the isolator through its Vitest plugin,
`@variance-authority/isolator/vite`.

## Run it

You need a checkout, `yarn install` and `yarn build`. From the repository root:

```bash
yarn vitest run --config vitest.integration.config.mts cases/vitest-shared-modules-case/src/resets.integration.test.ts
```

## What it shows

- With nothing resetting it, the worker evaluates `counter.ts` once, and every
  test after the first meets what the one before it left, across files too.
- With `isolate: true`, each file evaluates it again and starts clean; the tests
  inside a file still share it.
- ioc's driver resets `tally.ts` in both files, though Vitest runs the setup file
  again on modules already loaded: a second `configureResetHandler` finds the
  handlers registered under the first and installs them again.
- With the isolator rewriting the application modules, every test in both files
  starts from the values each module was loaded with, and the worker still
  evaluates `counter.ts` once.
- With the README's config, the file that mocks runs in a worker of its own and
  its mock reaches the module. Put it in the shared worker after a file that
  loaded that module, and it reads the real one.
