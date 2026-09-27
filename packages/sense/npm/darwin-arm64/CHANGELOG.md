# @variance-authority/sense-darwin-arm64

## 0.10.0

## 0.9.0

### Patch Changes

- 0580380: A subpath import such as `import { x } from '#polyfill'` is an edge in the file graph. Both scanners cut every specifier at its first `#`, which is right for a stylesheet's `url(#gradient)` and left a subpath import empty, so a change to the file a `package.json` `imports` map names reached none of its importers. A leading `#` in a module specifier now resolves through the `imports` field, a stylesheet fragment stays external, and `select --execution` can resolve a `#` import a diff added to ask whether its package declares `sideEffects`.
- b04ad08: A type in a decorated class is now read as a load-time change. Under `emitDecoratorMetadata`, TypeScript writes the types of a decorated class's constructor parameters and decorated members into metadata calls that run when the class is defined, and a dependency-injection container reads them. Changing the type of an injected service used to read as `none` and select nothing. A changed parameter decorator such as `@Inject(TOKEN)`, which also runs when the class is defined, used to read as a function body. Types inside method bodies, and in classes with no decorator, still select nothing.
- dea658f: A JSX pragma comment that is added, removed or given another argument (`@jsx`, `@jsxFrag`, `@jsxImportSource`, `@jsxRuntime`) is now read as a load-time change, so it selects every test that loaded the file. It used to read as `none` and select nothing, although it decides what every element compiles to and which runtime the module imports.
- 28c7086: `@variance-authority/sense/runner` records a suite from a runner this package has no seam for. `startRecording` opens the run and folds it, `registerRecording` instruments ES modules, CommonJS and Node-stripped TypeScript through `module.registerHooks` (or `instrumentModule` from the runner's own transform), and `observeTestFile` brackets each test file and case. Processes a runner forks join the recording through `VARIANCE_AUTHORITY_RECORDING`, and the snapshot is the one `variance select` already reads.

## 0.8.1

### Patch Changes

- 96a50bf: A changed file that one module imports as an asset and another declares with `/// <depends path>` selects the tests behind both. The walk from an asset now follows `depends` edges as well as `asset` edges.
- 96a50bf: `variance run --since` and `variance select` print one line per changed file saying how it was read, or why it was not, and name each test that loaded it through an import the file graph does not list; `variance select --format json` gives the same readings as `readings`, and `@variance-authority/sense/test-selection` exports the formatter as `readingLines`.

## 0.8.0

### Minor Changes

- 3cb0ce8: An edit at a module's top level is now charged by what it does, not by the
  lines it sits on. Before, any such edit selected every test that loaded the
  module. With `sourceAt`, each changed file is read from the recorded text and
  the text the diff makes of it, and gets one verdict. A comment, a type or
  formatting selects nothing. A new function, or an edit inside one, selects the
  tests that entered the changed regions. A changed top-level value, such as
  `LIMIT = 10` becoming `20`, also selects the tests that entered a function
  reading it, in the file or in a file that imports it. An edit that changes what
  the module runs as it loads still selects every test that loaded it.
  
  `narrowByExecution` returns `readings`, one per changed file: the verdict and
  the names whose values moved, or why the file could not be read (`source`,
  `hunk`, `parse` or `addon`). A test selected through a read carries a `reader`
  reason naming the value, the file that declares it and the file that reads it.
  `test:since` prints a line per reading.
  
  A change travels by use. A new module selects nothing until something calls it,
  and an import added to a file charges the functions that use its names, not
  every test that loads the file. With `root`, the nearest `package.json` of a
  changed file, and of every file an added or removed import loads that the file
  did not already load, is asked for `sideEffects`: a declared file, or an
  importer that starts or stops loading one, is read as `load`, and its reading
  lists the declared files in `effects`. A test that loaded a changed module through no
  importer the graph holds is listed in the reading's `unseen` and no longer
  selected.
- 97e1ce6: A module can name a file it reads without importing it:
  `/// <depends path="./schema.graphql" />`, anywhere in the file. The scan draws
  a `depends` edge to that file, so a change to it reaches the tests that load
  the module. TypeScript and every runtime read the line as a comment. A directive
  that names no `path` is reported in the file's `unknown`. The source index
  format moves to version 11, so an existing index is read again once.
- 956ef8b: A function's region now starts at its parameter list, not at its body. An edit
  to a parameter selects the tests that called the function. Before, it selected
  every test that loaded the module around the function. A function in a
  parameter's default value is now owned by the function whose parameter it is.
  The instrumentation ids are now `sense:instrument/presence-v5` and
  `sense:instrument/entries-v2`, so a recording made under the old ids is read as
  stale and recorded again.
- e3f608d: Instrumentation now runs in the native addon only. `instrument()` without the
  addon throws and names the package that did not load, rather than recording
  nothing. The addon now names a regular-expression key as `String(regex)` does,
  and writes a lone surrogate in a key as `\uXXXX`. A source whose text holds a
  lone surrogate is left uninstrumented. The `Edit` type is removed from
  `@variance-authority/sense/instrument`.

### Patch Changes

- 3cb0ce8: A call that throws while a function's parameters bind now counts as entering
  the function. Before, `f('label')` against `function f(label, { required })`
  threw before the body ran, so the test was never recorded as entering `f`. An
  edit that gave the parameter a default then selected nobody. The function's
  `length`, its `arguments` and the order its parameters bind in are unchanged.
  The one exception is a first parameter that is an object pattern: its text
  stays as written, because Vitest, Playwright and Rstest read fixture names from
  it.
  
  An edit to any line of a multi-line `await` now also selects the tests that
  entered the function, not only the tests that resumed after it. The awaited
  expression is evaluated before the await settles, so a test whose promise
  rejected ran that line too.

## 0.7.0

## 0.6.0

## 0.5.10

## 0.5.9

### Patch Changes

- 50be015: Instrument modules in the native scanner
  
  `instrument()` now parses, walks and splices in the addon, so the syntax tree
  never crosses into JavaScript: 64 µs a module instead of 161 µs over this
  repository's sources, byte for byte the same output. Without the addon, the
  JavaScript walk answers as before.
  
  A module whose first statement after its imports is a top-level `await` no
  longer loses its probe runtime: the header used to land inside the `await`'s
  probe and was not declared.
  
  The scanner on Apple Silicon hashes with the ARMv8 SHA instructions, five
  times faster than before, which every digest it takes shares.

## 0.5.8

## 0.5.7

## 0.5.6

### Patch Changes

- 9e1b8ef: Refuse to publish a native Sense package without its scanner binary
  
  Each platform package checks that `scan.node` exists and is large enough to be
  the compiled scanner before a pack or publish can proceed.

## 0.5.5

## 0.5.4

## 0.5.3

## 0.5.2

## 0.5.1

## 0.5.0

## 0.4.1

## 0.4.0

## 0.3.0
