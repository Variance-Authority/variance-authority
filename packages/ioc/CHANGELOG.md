# @variance-authority/ioc

## 0.33.0

No changes in this release.

## 0.32.1

No changes in this release.

## 0.32.0

No changes in this release.

## 0.31.0

No changes in this release.

## 0.30.0

### Patch Changes

- edc6d7d: The README and the skill print `variance`, the command a package manager runs from the install, where they printed a runner that fetches another package when the install is missing.

## 0.29.0

No changes in this release.

## 0.28.0

No changes in this release.

## 0.27.0

No changes in this release.

## 0.26.0

No changes in this release.

## 0.25.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.24.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.24.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.23.0

### Minor Changes

- 589a181: `driverInstalled()` from `@variance-authority/ioc/reset` tells a scope that registers late whether a test setup has already installed a driver, so it knows the file it joined has started.

## 0.22.0

### Minor Changes

- c7bd5ff: A test reads what its file left before it

  The isolator started every test on the values its modules were loaded with, so
  what a `beforeAll` wrote was gone by the first test. Under Vitest's `isolate: false`, a
  file was collected against whatever the files before it left. Now a file
  starts on the values its modules were loaded with, and each test runs in a
  session of its own that starts from what the file wrote while it was collected
  and in its `beforeAll` and `afterAll` hooks. What the test, its `beforeEach` and
  its `afterEach` write is dropped when it ends. What a module writes into
  another module as it loads, such as a plugin it adds to a registry, lands in
  every session, the ones that already read the registry and every one after: a
  module loads once, and on a page of its own the registration would be there.

  A concurrent test starts from the same file session, through
  `isolateConcurrentTests` and `isolateConcurrentEach`.

  `configureResetHandler` now takes the runner's `afterEach` as a required second
  argument: `configureResetHandler(beforeEach, afterEach)`. A driver that never
  hears a test end would leave what a nested `describe`'s `beforeAll` writes in
  the test before it, so a call without it throws. ioc also gains
  `registerTestScope(scope)`, which the isolator registers in place of a reset
  handler.

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

### Patch Changes

- 417c97d: `package.json` declares `sideEffects: true`: the reset registry is state every test shares, so a bundler keeps it and `@variance-authority/isolator` leaves it as it is.

## 0.19.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.18.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.16.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.15.0

### Patch Changes

- ef496ad: READMEs name what the program does

  The package READMEs, and the `@variance-authority/vantage` and
  `@variance-authority/playwright-test` descriptions, no longer write a test, a
  record or a run as something that says, asks or knows. Each sentence names what
  the program does: a command prints, a record holds a field, a test runs or
  covers. Where a value is filled in from configuration or a default rather than
  recorded, the README says so. Four renamed headings change their anchors:
  `help`'s "Where the declaration is undocumented", `playwright`'s "Where a
  component is declared, read from the engine", `storybook`'s "What a pass sends
  the preview" and `sense`'s "Correct what a file's text declares it imports".

## 0.14.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.13.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.12.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.11.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.10.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.9.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.7.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.6.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.10

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.9

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.8

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.7

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

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
