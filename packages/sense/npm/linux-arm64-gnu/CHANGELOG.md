# @variance-authority/sense-linux-arm64-gnu

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
- 1ce9a2e: `@variance-authority/sense-linux-arm64-gnu` carries the prebuilt scanner for
  Linux on arm64 against glibc 2.17 or newer, so Docker on Apple Silicon and arm
  CI runners load the addon rather than building it.
