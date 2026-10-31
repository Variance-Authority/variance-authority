# @variance-authority/sense-linux-arm64-gnu

## 0.22.0

## 0.21.0

## 0.20.0

## 0.19.0

## 0.18.0

## 0.17.1

## 0.17.0

## 0.16.0

### Minor Changes

- d39dbc4: A build-time compiler reads your code, not the probes
  
  Every seam probed a module before your own transforms ran, so a compiler that
  reads the syntax it compiles saw a probe where your code was. Compiled could not
  extract the styles of a `styled` call that takes a function, and silently turned
  a dynamic prop into a runtime CSS variable, so the recorded build was not the
  build you ship. React Compiler restructured probed components the same way.
  `testSelectionProbes` and the Vitest, Jest and Rstest seams now place the
  probes after your transforms: in Vite at `enforce: 'post'`, in Jest
  around the transformer you configured, in Rstest with a second loader at
  `enforce: 'post'`. Each module is still cut from the file on disk — named after
  it, digested as its text, placed on its lines — and the probes are written into
  the transformed text where the transforms' combined map carries each region.
  A plugin of yours whose `transform` is ordered `post` and listed after
  `testSelectionProbes` would run after the probes and read them, so the run
  stops when the configuration resolves, naming it: list it before the probes,
  or set `placement: 'before-transforms'`. A plain `transform` at `enforce: 'post'`
  runs ahead of the probes. The plugin's `transform` is now an object hook,
  `{ order, handler }`: code that calls it directly calls `transform.handler`.
  Under Rstest the second loader's rule goes first among the rules, after
  `tools.rspack` has run, so it runs after every post loader of yours.
  
  A `vite build` that writes no source map, Vite's default, still places the
  probes where your code went. Vite reprints a module that reads
  `import.meta.env`, `process.env` or a `define`, and hands its map on only where
  the build writes maps, so `testSelectionProbes` turns maps on for the
  transforms, as `hidden`, and takes the map of each chunk and asset back out of the
  bundle: the build writes what it wrote without the probes. A `.map` file
  another plugin emits stays.
  
  `instrument()` answers two more fields: `module`, whether the text imports or
  exports, and `headerAt`, where the header starts past the directive prologue.
  
  A region can now be recorded as running when it did not. A region the map
  gives no code of its own is recorded running when the function holding the
  code in front of it is entered, or when the module loads, and a compiler's own
  map can widen a region too: React Compiler's sends the code after an early
  `return` to the component's entry, and its `c()` cache call maps to the
  import, so a probe fires on every render. An import of a variant of a file,
  such as `?raw`, that no map leads back from is recorded as the file loaded.
  Each selects a test it did not need to. None leaves out a test that ran the
  region, as long as a transform that returns `map: null` moved nothing on any
  line: one that moves code along a line, with no transform after it that writes
  a map, places the probes at the columns the file had.
  
  These stop a run that went through before, each with an error naming the file:
  
  - A file your transforms rewrote with a map that leads back to no source that
    is the file, that carries a text for the file other than the file on disk, or,
    for a file with more regions than the module's own, that holds no mappings. Have the transform write its map against the file it
    was handed.
  - Under Vite or Vitest, a plugin ahead of the probes whose `transform` or
    `load` rewrote a file and returned no source map, named, and one whose
    `transform` returned `map: null` and changed the file's line count, other
    than by appending to it. Return its map, or `map: null` when no position
    moved.
  - Text your transforms wrote that the instrumenter cannot parse, from a file
    it can.
  - A file the probes cannot read for any reason other than its absence, such
    as `EACCES`, with the reason.
  - Under Vitest, a test file the run cuts whose `load` hook rewrote it, named
    by the hook's plugin. Any other file a `load` hook rewrote goes on to the
    probes, which place it through the map the hook returned.
  - Under Rstest, a file that reaches the second loader with no map: leave
    Rspack's `devtool` writing source maps, as Rstest sets it.
  - Under Rstest, a configuration assembled by hand that names
    `@variance-authority/sense/rstest-loader` and not the new
    `@variance-authority/sense/rstest-after-loader` fails at the first file, or,
    where Rspack lists no loaders, when the run ends. Add the second loader at
    `enforce: 'post'`.
  
  Four cases still meet the probes before your transforms: a file that names its
  own source map, such as a built package, under a Vite dev server, Vitest or
  Rstest, and under Jest where the transformer composed that map; a file under a Jest transformer that rewrites it and returns no map, or
  a map that leads elsewhere, which transforms it twice and now warns once per
  transformer, by name;
  every file under Vitest browser mode; and a test file, whose lines are marked
  for its cases first.

## 0.15.0

### Minor Changes

- 0446884: A module that passes a function to `page.evaluate` can now be instrumented
  
  `page.evaluate(fn)` sends `fn.toString()` to the browser. A probe inside that
  text called a declaration the page does not have, and threw `ReferenceError` at
  the first one, so a module that handed any function to a page had to stay out
  of instrumentation whole. The transform now reads the call: the function passed
  to `evaluate`, `evaluateAll`, `evaluateHandle`, `evaluateOnNewDocument`,
  `addInitScript`, `waitForFunction`, `$eval` or `$$eval`, written at the call or
  declared in the same module, gets no probes. The rest of the module is probed as
  before, and an edit inside the function is charged to the region around it. A
  function declaration exists from the moment its block starts, so one written
  after a `return`, or under another `case` of the `switch` that sends it, is
  charged to the tests that entered the block, the early leavers and the other
  cases included. A function imported from another module and sent from
  this one is not found, and the module that writes it still needs leaving out.
  
  The instrumentation ids are now `sense:instrument/presence-v6` and
  `sense:instrument/entries-v3`, so a recording made under the old ids is read as
  stale and recorded again.

## 0.14.0

## 0.13.0

## 0.12.0

## 0.11.0

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
- 1ce9a2e: `@variance-authority/sense-linux-arm64-gnu` carries the prebuilt scanner for
  Linux on arm64 against glibc 2.17 or newer, so Docker on Apple Silicon and arm
  CI runners load the addon rather than building it.
