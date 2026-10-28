# @variance-authority/isolator

## 0.21.0

### Patch Changes

- c67dd01: `sense` and `isolator` each carry their own copy of the code that loads a project's Jest transformer, and `@variance-authority/jest-transformer` is no longer a package.

## 0.20.0

### Minor Changes

- 54efbd1: New, experimental package: a transform that moves a module's mutable state — every module-level `let` or `var` the module writes and does not export, and every declaration that holds an object of its own — into a frame with one set of values per session. Functions, classes and values nobody writes are never wrapped. `isolate(code, file)` from `/transform` is the whole transform; `/jest` and `/loader` (Rspack and webpack) call it. Each declaration runs once; every session starts from a copy of what the module held once it loaded. ioc's per-test driver starts a new session before each test, and `isolateConcurrentTests(test)` one per concurrent Jest test; `isolated(fn)` makes one in Node, `requestSessions()` one per React Server Components request, and `nextSession()` one in a browser. `@isolator-ignore`, `exclude` and a package's `sideEffects` keep a declaration or a module shared. Every read goes through a JavaScript frame; its performance waits on a Rust port.
- 54efbd1: New package `@variance-authority/jest-transformer` loads a project's own Jest transformer the way Jest does — resolved from the project or where `jest-config` finds it, required or imported, built by its `createTransformer` — and answers which files Jest calls tests, for a transformer that runs around it. The Jest transformers of `@variance-authority/sense` and `@variance-authority/isolator` both reach the project's transformer through it. Sense's now calls the wrapped transformer's methods bound to it, so a class-based transformer that reads `this` keeps it. Both hand the wrapped transformer the options its own entry gave, and `{}` when it gave none, never their own. Isolator tests a `testRegex` against the path as the runner spells it, as Jest does, rather than with its separators turned to `/`.
