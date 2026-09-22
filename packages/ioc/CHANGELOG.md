# @variance-authority/ioc

## 0.5.6

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.5

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.4

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.3

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.2

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

### Minor Changes

- 8542d1b: A module says how it resets, and the runner says when

  A module-level `let` outlives the test that changed it, so a suite that passes in
  the order it was written fails in another one — and the failure names the test
  that read the state rather than the one that wrote it. Rebuilding the world
  between tests pays setup on every test and destroys the evidence that would have
  identified the leak; reaching into a module's internals from a test file makes
  the test know things the module never promised.

  `@variance-authority/ioc/reset` inverts it. `registerResetHandler` goes beside
  the state, at module scope, in the module that owns it.
  `configureResetHandler(beforeEach)`, from `/reset/setup`, hands the package the
  runner's own per-test hook — Vitest, Jest, Mocha and Playwright all fit, because
  it takes the shape those hooks share and imports none of them.

  **The gate is the driver, not the build mode.** `NODE_ENV === 'production'` is
  the obvious condition and the wrong question: a static Storybook build *is* a
  production build and it is exactly where a collector runs a suite, so that gate
  would switch the resets off in the environment that needs them most. Keyed on
  whether a driver was installed, a shipped application pays one boolean
  comparison per registration and never runs a handler. It retains one reference —
  the first handler to arrive — so that a misordered setup can be named.

  **A misordered setup is refused by name.** A handler registers when its module is
  imported, so a module imported before the setup file has already asked and been
  refused. Rather than drop it silently, `configureResetHandler` throws, counts
  them, and quotes the first — a suite that quietly does not reset is the failure
  the package was added to remove, so the check is unconditional and has no
  opt-out.

  The registry lives on `globalThis` under a well-known symbol rather than in
  module scope, because *has a setup installed a driver?* has to be answerable
  from the copy of the module the application imported: `jest.resetModules()`,
  a dual CJS/ESM resolution, and a fresh module graph per test file each give a
  module-scoped flag the wrong answer in a correctly configured suite.

  One handler that throws does not stop the others. Every handler runs and the
  failures are reported together, because skipping the rest would leave exactly
  the order-dependent state the reset was for.
