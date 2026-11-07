# @variance-authority/isolator

## 0.27.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.26.0

### Patch Changes

- 4553d53: Runtime dependencies move to what npm publishes now: `oxc-parser` 0.157,
  `magic-string` 1.4 and `sharp` 0.35.

  `@variance-authority/sense` treats an exported object whose key holds a lone
  surrogate as it treats a spread or a computed key: the module's exports are not
  known, because no importer can spell that name. An import or an export whose
  specifier holds one is counted on the read as a specifier it cannot read.

## 0.25.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.24.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.24.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.23.0

### Minor Changes

- 82fe48a: Isolate what no module owns, per session, from the main entry: `isolateEnv()` gives each test its own `process.env`, `isolateGlobals()` puts global properties back as each test ends, `isolateTimers()` cancels the timers a test leaves pending, and `isolateListeners()` removes the event listeners it leaves attached, telling `report` where each was added and keeping those a package under `node_modules` adds, as React adds its own to a portal's container. `perSession(object)` is the proxy beneath `isolateEnv`, for any other object. What setup does before the first test, a Storybook preview as it boots included, stays in every session. `isolateEnv`, `isolateGlobals` and `isolateTimers` run in Jest, Vitest, a web bundle built with the Rspack or webpack loader, and Storybook, where `isolateEnv()` installs nothing without a `process`; `isolateListeners` is for unit tests.

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
- c41fe54: The Vite plugin runs under Vite alone, as in Storybook: it takes its root from Vite's resolved config and rewrites every module but the ones `exclude` names. With `nextSession()` called on Storybook's `setCurrentStory`, before the next story's file is imported, each story switched to on one preview page reads its modules as a page of its own would. The README's "Run it in Storybook" has the setup.

### Patch Changes

- b2cfa37: The isolator runs in Vitest 5 through `@variance-authority/isolator/vite`, so a suite under `isolate: false` keeps its modules loaded across files while every test, concurrent ones included through `isolateConcurrentEach(aroundEach)`, reads the values they were loaded with.

## 0.21.0

### Patch Changes

- c67dd01: `sense` and `isolator` each carry their own copy of the code that loads a project's Jest transformer, and `@variance-authority/jest-transformer` is no longer a package.

## 0.20.0

### Minor Changes

- 54efbd1: New, experimental package: a transform that moves a module's mutable state — every module-level `let` or `var` the module writes and does not export, and every declaration that holds an object of its own — into a frame with one set of values per session. Functions, classes and values nobody writes are never wrapped. `isolate(code, file)` from `/transform` is the whole transform; `/jest` and `/loader` (Rspack and webpack) call it. Each declaration runs once; every session starts from a copy of what the module held once it loaded. ioc's per-test driver starts a new session before each test, and `isolateConcurrentTests(test)` one per concurrent Jest test; `isolated(fn)` makes one in Node, `requestSessions()` one per React Server Components request, and `nextSession()` one in a browser. `@isolator-ignore`, `exclude` and a package's `sideEffects` keep a declaration or a module shared. Every read goes through a JavaScript frame; its performance waits on a Rust port.
- 54efbd1: New package `@variance-authority/jest-transformer` loads a project's own Jest transformer the way Jest does — resolved from the project or where `jest-config` finds it, required or imported, built by its `createTransformer` — and answers which files Jest calls tests, for a transformer that runs around it. The Jest transformers of `@variance-authority/sense` and `@variance-authority/isolator` both reach the project's transformer through it. Sense's now calls the wrapped transformer's methods bound to it, so a class-based transformer that reads `this` keeps it. Both hand the wrapped transformer the options its own entry gave, and `{}` when it gave none, never their own. Isolator tests a `testRegex` against the path as the runner spells it, as Jest does, rather than with its separators turned to `/`.
