# @variance-authority/sense

## 0.9.0

### Minor Changes

- be8f5fa: `variance covering --since <ref> --against <record>` says which regions a change's tests moved

  Two case indexes are compared region by region, and each region whose cases
  moved is lost, hidden, thinned or gained. Each test file says how many regions
  it now enters and no longer enters. The files the base branch changed after the
  base was recorded are left out and named. `--cases last` makes the same
  comparison against the cases the last run replaced. `--format refs` names each
  moved region's cases by number. `caseMotion` in
  `@variance-authority/sense/test-selection` is the comparison, and each region
  carries the cases at both ends as the records hold them.
- 2f0b151: A changed JavaScript or TypeScript file whose edit is a comment, a type or formatting no longer seeds the file-graph walk. `variance reach` leaves it out of the list and names it on stderr, and refuses a diff made only of such files. `variance run --since` reaches no component through it and no longer runs the whole suite over it. `runsAsBefore` in `@variance-authority/sense/test-selection` reads, for each file of a diff, which of its exports changed since a commit; an empty list is a file that runs what it ran.
- 9b0c94d: `variance covering --cases last|<test file>` answers from the chosen cases instead of the whole suite

  `last` is the run that wrote the case index last. A test file is every case the
  index holds for it. The answer starts by saying which cases it was read from,
  and `--format json` names them under `scope`. `caseLayerFiles` in `@variance-authority/sense/test-selection` names
  the files beside the index that record the last run and what that run replaced.
- 0b81e06: Sense has one module reader now: the native addon. The JavaScript reader it used without the addon is gone. On a machine where the addon does not load, reading a module fails with the reason instead of falling back to a slower second copy. That copy had already fallen behind: it never recorded the names read off `import()` or a namespace.

  A React component in a `.js`, `.mjs` or `.cjs` file now reads with its JSX, both in the file graph and when test selection reads a change. The addon used to leave JSX off for those extensions. A scan without the addon hid the problem, and on a machine with the addon those files got no edges, and a change to one was charged as a file that does not parse.
- 2958674: `variance reach` and `variance run --since` walk from the exports a JavaScript or TypeScript edit changed, not from the whole file. A file that imports only exports the edit left as they were is not reached, and a barrel passes each changed export on under the name it republishes it as. Stderr names the changed exports of each file, and `variance reach --format json` lists them under `exports`. A namespace import, a `require`, a dynamic `import()` and an import that binds nothing are still walked whole. `affectedBy` in `@variance-authority/core/relate` takes `moved`, the exports each seed changed, and `relationsOfFiles` takes `uses`, the names each import binds; `readPublishedSources` in `@variance-authority/sense` returns that lookup, read from the parses the index already stores.

### Patch Changes

- fce1fd6: `variance covering --format refs` numbers each case once and names every range's cases by number

  The table at the end lists each test file once with its cases under it, and a
  range reads `1-5 walked: 1,3-11,2*`, where `*` marks a case that was inside only
  while the module evaluated. The text answer names each test file once, prints
  a case's id only when it is not the file and the name, and a range walked by
  cases already listed points at the range that listed them.
- f7e5b66: `variance select --execution` reads each changed module from both of its texts before charging its lines, as a selection from the snapshot already does. A comment added above a function sits between two declarations, in the region the module ran as it loaded, and it was charged to every file that imports the module: one comment in a widely imported file selected thousands of test files where the runtime change beside it selected six. The old text is the blob the patch names. A change that proves to run nothing now charges nothing, and one that leaves what the module does as it loads charges only the functions its lines fall in. A patch without `index` lines is charged by its lines, as before, and `select` prints each file's reading.
- f529451: A Vitest run started with `--reporter` records

  A command-line `--reporter` replaces the configured reporters, and an editor that runs a test from the gutter passes its own. `withTestSelection` now folds such a run when its server closes, from what its case runner wrote, so the record and the case index are written as for any other run. A project with its own `runner` is told the run recorded nothing, instead of getting no record and no message.
- c1fdf46: A `pnpm-lock.yaml` that aliases a package to a tarball URL is read. pnpm writes that key unquoted, `zod443@https://registry.npmjs.org/zod/-/zod-4.4.3.tgz:`, and the reader split it at the first colon, refused the file, and `variance select` ran every test on any commit that changed the lockfile. A plain key now ends where YAML ends it, at the first colon followed by a space or the end of the line.
- aa57273: `ask uses` finds a name your code reads off `import()` or `import * as`. It used to answer that nothing imported `narrowByJourneys` when `select-command.ts` read it as `selection.narrowByJourneys` after `const selection = await import(…)`. Such a site now names the line that loads the module, and an `import()` site says the module loads when that call runs, not when the file loads.

  The parse carries these reads as `members`, apart from each request's `bindings`, so test selection reads exactly what it read before. The source index moves to version 12 and the help snapshot to version 3, and each is rebuilt on the first question after the upgrade.
- 0580380: A subpath import such as `import { x } from '#polyfill'` is an edge in the file graph. Both scanners cut every specifier at its first `#`, which is right for a stylesheet's `url(#gradient)` and left a subpath import empty, so a change to the file a `package.json` `imports` map names reached none of its importers. A leading `#` in a module specifier now resolves through the `imports` field, a stylesheet fragment stays external, and `select --execution` can resolve a `#` import a diff added to ask whether its package declares `sideEffects`.
- b04ad08: A type in a decorated class is now read as a load-time change. Under `emitDecoratorMetadata`, TypeScript writes the types of a decorated class's constructor parameters and decorated members into metadata calls that run when the class is defined, and a dependency-injection container reads them. Changing the type of an injected service used to read as `none` and select nothing. A changed parameter decorator such as `@Inject(TOKEN)`, which also runs when the class is defined, used to read as a function body. Types inside method bodies, and in classes with no decorator, still select nothing.
- dea658f: A JSX pragma comment that is added, removed or given another argument (`@jsx`, `@jsxFrag`, `@jsxImportSource`, `@jsxRuntime`) is now read as a load-time change, so it selects every test that loaded the file. It used to read as `none` and select nothing, although it decides what every element compiles to and which runtime the module imports.
- f7d90dc: A project's configuration governs its own tests. In a Vitest run with `projects`, a project's config file, the local modules it imports and its setup files are preconditions of that project's tests only, and the setup files are resolved against the project's own root, so one named relative to it is declared rather than missed. Jest reads each test's setup and environment files from the project it ran under, and Rstest keeps a named project's setup files for its own tests. The configuration that lists the projects stays a precondition of every test, and a test whose project the runner does not name rests on every project's files.
- 28c7086: `@variance-authority/sense/runner` records a suite from a runner this package has no seam for. `startRecording` opens the run and folds it, `registerRecording` instruments ES modules, CommonJS and Node-stripped TypeScript through `module.registerHooks` (or `instrumentModule` from the runner's own transform), and `observeTestFile` brackets each test file and case. Processes a runner forks join the recording through `VARIANCE_AUTHORITY_RECORDING`, and the snapshot is the one `variance select` already reads.
- 47e6664: What the CLI, the MCP tools, the servers and the GitHub action print is shorter. An explanation that repeated on every row now prints once, as a header or on the first line that needs it. The reasoning behind an answer stays in the source and is no longer printed. The source snapshot footer is one line, `Snapshot <time>.`

  A changed file in a language the verdict does not read, such as Rust or Python, now reads as `unread (not a JavaScript or TypeScript module)` instead of as a file that does not parse. It is charged the same way.
- 990ac1a: The agent skills name the commands that ship

  The test-selection skill no longer says there is no command line: it routes
  to `variance select`, `reach`, `index` and `covering`. The CLI skill lists
  every command that reads no config, and covers `covering --hops`, `--cases`,
  the per-file rows, `gained` motion and the `unrecorded` refusal. The workspace
  skill names `variance ask` as the same six questions.
- 93d53c8: One `variance-authority` skill ships in `@variance-authority/cli`, with a reference file per question, and `variance doctor` says whether your agent can find it

  The skill lives at `skills/variance-authority/`, where skill finders that read
  `skills/<name>/SKILL.md` see it. Its `SKILL.md` routes each question to one file
  under `references/`: reading a run, locating a subject, a live run, producers,
  covering, test selection and its wiring, distillation, the workspace API and
  MCP. It now also holds the test-selection guidance that shipped in
  `@variance-authority/sense` and the workspace-API guidance that shipped in
  `@variance-authority/help`; neither package ships a skill any more.

  `variance doctor` looks in `.agents/skills` and `.claude/skills`, in the project
  and your home directory, and reports each shipped skill as a link, a matching
  copy or a stale copy. For a skill it cannot find, it prints the `ln -s` that
  would serve it. It writes nothing, and the finding never changes the exit code.
- 9b0c94d: A run of one test file no longer erases every other case from the case index

  `cases.bin` held the last run's cases and nothing else. After `vitest run
  src/cart.test.ts`, `covering` and both editors marked every region that file did
  not reach as unwalked, even though the rest of the suite reaches it. The index is
  now updated the way the snapshot is. A test file that ran to the end has its
  cases replaced. A file that did not finish keeps its old cases, and the ones that
  ran again are updated. A test file that is gone from the checkout loses its
  cases. Every other case is kept. Kept cases are matched to the regions recorded
  now by name, structural path and kind. A region that no longer matches drops
  them instead of moving them to a guessed place.

  Two files now sit beside the index. `cases.last.json` names the run that wrote it
  last: its commit, time, test files and cases. `cases.before.bin` holds what the
  index had for those test files before the run replaced them.
- 743385a: A file resolves under the `customConditions` of the `tsconfig` that governs it, added to `source`, `import`, `require` and `default`. A workspace whose packages export source under a condition of their own, such as `"@tanstack/custom-condition": "./src/index.ts"` beside an `import` that names built output the checkout does not hold, now has edges into that source, so `variance reach` walks from a changed package into the packages that import it. `extends` is followed the way TypeScript follows it: a config that sets the option replaces what it inherits, and `null` or `[]` clears it. A named `tsconfig` supplies its own conditions, and `conditionNames` you pass stay the whole set. Stored records are read again once, because the conditions a record was resolved under are part of its key.

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
- 4250eda: Every run records which case entered each region. The `cases` option is removed
  from `withTestSelection` for Vitest, Jest and Rstest, from the Playwright
  recorder and reporter, and from the Storybook recorder: each writes
  `<coverage file>.cases.bin` beside the file-level snapshot, or `executionFile`
  when you name one. A test file that runs in a page is still recorded per file,
  and says so.

  Without `continuations: true`, a file whose cases overlap no longer fails the
  run. It is recorded as a whole, so a change it reaches runs every case in it, and
  the run names the two cases that were open at once.
- e3f608d: Instrumentation now runs in the native addon only. `instrument()` without the
  addon throws and names the package that did not load, rather than recording
  nothing. The addon now names a regular-expression key as `String(regex)` does,
  and writes a lone surrogate in a key as `\uXXXX`. A source whose text holds a
  lone surrogate is left uninstrumented. The `Edit` type is removed from
  `@variance-authority/sense/instrument`.
- e4ee0da: The repository names its cache. Set `cacheRoot` in the `variance.config.json` at the repository root, for example `".variance/cache"`, and every command, every test runner integration and every function that takes a `cacheRoot` option uses that directory. The path resolves against the repository root. Without the key the cache is `$XDG_CACHE_HOME/variance-authority`, or `~/.cache/variance-authority`, as before, so an existing recording stays where it is. The key is read before the environment, so a sandboxed agent that sets `XDG_CACHE_HOME` to a temporary directory no longer splits the recording away from your own runs. [The cache](https://variance-authority.dev/docs/cache) page describes the location, what is in it, worktrees and CI.

  `@variance-authority/sense` exports `cacheRootFor(root)`, which returns that answer, and `CACHE_CONFIG`. `defaultCacheRoot` is removed; call `cacheRootFor(root)`. A `cacheRoot` option now names the variance-authority directory itself, and `test-selection/` is created under it. `testCoverageFile`, `seedTestCoverage`, `readableTestCoverage`, `moduleNamesFile`, `openModuleNames`, `recordStore`, `recordStores` and `repositoryLayers` take an optional `cacheRoot`. An empty or relative `XDG_CACHE_HOME` is ignored rather than resolved against the working directory. A root `variance.config.json` that is not JSON, or whose `cacheRoot` is not a non-empty string, is an error.

  `@variance-authority/cli` accepts `cacheRoot` in the config and in the schema, and refuses it in a `variance.config.json` below the repository root. `variance run`'s render cache and suite indexes are under it. `renderCacheRoot` and `suiteIndexPath` take the config.

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
- 3cb0ce8: A region that a transform writes with no source-map origin is now recorded with
  no lines. Before, it was given the line it had in the generated text. The main
  case is the helpers esbuild writes above the first line of a module with a
  decorator, which landed on the lines below them. An edit to a function after a
  decorated class then selected the test that ran the helpers instead of the test
  that called the function. Selection, `covering` and journeys skip a region with
  no lines. A module recorded before this change keeps the old lines until a run
  records it again.
- 1ce9a2e: `@variance-authority/sense-linux-arm64-gnu` carries the prebuilt scanner for
  Linux on arm64 against glibc 2.17 or newer, so Docker on Apple Silicon and arm
  CI runners load the addon rather than building it.

## 0.7.0

### Minor Changes

- c6543c7: A head's account that lands after the last spec is recorded

  A head reports a request when what its handler returned settles, which can be
  well after the response went out: a streamed body, a write behind, a log flushed
  after `end()`. When that happened in the last spec a worker ran, the account
  reached a worker that had already stopped listening, and it was dropped without
  a word. If every account from a head went that way, the run blamed the head for
  reporting nothing.

  A head now says a request opened before the handler runs, and every account
  says it settled. At teardown the worker waits up to five seconds for every
  opened request to settle before it records. One still open after that retires
  the run with a reason that names the head, as a silent head does.
  `unsettledScopes`, exported from `@variance-authority/sense/journey`, gives a
  driver of its own the same count to wait on.
- 6261ebe: `variance select --execution` traces a changed lockfile to the tests it reaches, and refuses a list of paths.

  A lockfile in the patch is compared as an install: the patch's `index` line names both blobs, git produces them, and every package that resolved differently is walked back through the packages resting on it to the files that import them. Those files' test files run, and so does every case the journey saw enter one of them. A lockfile the patch changes without naming its blobs keeps every test. `narrowByJourneys` and `selectJourneyFile` take the moved names as `packages`.

  A journey file selects by changed lines, so `git diff --name-only` handed to `--execution` is refused with a pointer to `variance reach`, which answers a list of paths from the import graph.
- dfab8cd: `variance select` reads a journey file against a change you hand in

  `variance select --execution journeys.bin` names the test files a change can
  skip, read off the journey file `journeys finalize` or `journeys stitch` wrote.
  The change comes from `--diff <patch>`, from `--diff -` on stdin, or from
  `git diff` against `--since`. A patch with hunks selects the cases that entered
  the innermost function holding each changed line. A case's crossings into a
  module it mocks do not select it.

  The reading happens in the native addon: `selectJourneyFile` answers a stitched
  file of hundreds of millions of crossings in milliseconds, where decoding it in
  JavaScript ran out of heap. `projectJourneyFile` returns only the regions a
  change lands on, and `variance covering --execution` reads through it.

  `variance covering --since <ref> --execution <journey-file>` diffs from the ref
  you give. It used to diff from the commit of the recorded snapshot, which a
  journey file does not have.
- 03d5589: `withTestSelection` records a browser-mode suite, under Vitest and under Rstest

  A test file that ran in a page recorded nothing. The setup module wrote its
  journal with `node:fs`, which a page does not have: Vitest stopped at the first
  import, and Rstest refused to build the suite.

  In a page, the setup module now installs the collector a Storybook preview
  uses. It attaches what the file ran to the file's own task in Vitest, or to the
  file's context in Rstest, and the runner carries it back to the reporter. The
  snapshot is the one a jsdom run writes, per test file, whether browser mode is
  set in the configuration or with `--browser.enabled`. Measured on Vitest 2, 3
  and 4, with and without isolation, and on Rstest 0.12.

  `cases` is not recorded in a page. A run that asks for it gets the file-level
  snapshot and a warning, rather than an empty case index.

### Patch Changes

- cb58788: A case index is replaced whole, never written in place

  `recordExecution` and the case fold wrote `.cases.bin` over the previous file.
  A worker killed during the write left an index the next `--since` could not
  decode. The index is now written beside the old one and renamed over it, as the
  snapshot already was.
- 3dc39cc: A mock no longer disowns what a case crossed. The runner installs a mock before the file's first case, so every crossing recorded inside a case or a hook ran the real module and selects that case, even in a module its file mocks. A mock still cuts what ran only while the module was evaluated, which is how a runner shapes an automock.
- 46f513e: A changed `package.json` is set aside only when the install comparison reads all of its change. A diff that moves `exports`, `imports`, `main`, `module`, `browser`, `type`, `sideEffects`, `name` or any field outside the dependency and publishing fields selected nothing and printed that the diff changed only manifests, while every importer of that package now loaded a different file. Each changed manifest is now read at both revisions, and one that moved a field the lockfile does not hold makes its package a changed directory: the walk reaches every importer, and a journal read charges every file of the package whole. `manifestMoved` in `@variance-authority/sense/lock` owns which fields the install speaks for.
- 66371ac: An update where nothing moved took about 2.8 s and 1.19 GB on 288,197 paths. It now takes about 1.5 s and 0.95 GB. Three things caused the extra cost. `updateSourceIndex` decoded the published chain twice, and now opens it once. At the top of a checkout the tree snapshot asked `git status --untracked-files=all -- .`, which git's untracked cache cannot answer. It now asks `--untracked-files=normal` with no pathspec, and lists each directory that `status` collapses with `git ls-files --others --exclude-standard`. With `core.fsmonitor` and `core.untrackedCache` set, that call costs 17 ms on a 41,171-path clone, down from 55 ms. The native snapshot no longer sorts a listing that git has already printed in order.

  This also fixes a defect in the native snapshot. A new directory in the working tree made `git hash-object` fail, and every path in the same batch was dropped, so files that existed were missing from the index. The directory is now expanded into its files before hashing.
- 846ab0d: A source index written before package names joined its dictionary could name a package after the file's first relative specifier. A package imported only by subpath, such as `@variance-authority/core/segment`, had no string of its own in the segment, and its id became row 0: whatever sorted first, which is usually a `../` request. The graph then held a package node called `../exit.js` whose importer never wrote `exit`. A cold cache showed nothing, because it encoded again with the fixed build. The index is now format 9, so every older segment is rebuilt rather than trusted. A decode refuses a stored package name that `packageOf` would not produce, and reads the segment as damaged. The source index, the execution indexes and the MCP source tree now intern through `intern` in `@variance-authority/core/segment`, which throws on a string the dictionary never collected rather than writing row 0.
- 6bb7386: What a handler's unreturned promise runs is recorded against its request

  A handler can start work it does not return: a write behind, an analytics
  call, a cache warmed after the response. That work still runs as the request,
  but once the request's scope had reported, the head forgot where the request's
  reports went. So everything the promise ran was dropped, with nothing counted
  and nothing said, and the next `--since` could skip the spec that caused it.

  The head now remembers where each journey reports after its scope closes, for
  the last 4096 journeys. What such a promise runs goes back as a scope of its
  own, which the driver waits for like any other. If a journey is too old to be
  remembered, the account is counted as lost, which retires the run.
- cf11776: The mock reader reads `jest.requireActual` and `vi.importActual` anywhere in a test file as an import of that module, and a mock of the same module no longer shadows it. A test that hands its mock the original implementation — `jest.fn(jest.requireActual('./x').X)`, or a `beforeEach` that restores it — is selected again when that module or anything under it changes. Cached mock readings from earlier versions are read again once.
- 23123e6: A driver a head first hears from late still gets every subject's initialization

  A head reported what ran outside any request, and what a module ran while it
  initialized, to whichever driver's request happened to be open. Under two
  workers the second never heard it, so its subjects missed the lines every
  request depends on, and a change to a module's top level could skip them.

  A head now keeps that account and sends each driver the part it has not been
  told, the first time that driver's request settles. `Channel.home` names the
  driver a channel reaches, which is what the head keys on.
- 2747428: A page with two instrumented bundles reports what it ran

  Every bundle built with `testSelectionProbes()` brings its own copy of the page
  collector. When a page loaded two of them, such as an application and a widget
  built separately, or a collector module that was evaluated a second time, the
  second copy wrote its crossings to the first copy's log. It then replaced the
  first copy's drain with its own, which reads a log nothing writes to. The driver
  then drained an empty journal, recorded that the page ran nothing, and the next
  `--since` skipped the subject over lines it had run.

  The drain now belongs to the collector that installed the log. A later copy
  adds its crossings to that log and leaves the drain in place.
- a2dac26: The scan now records what each file mocks in its parse, in both the JavaScript and the native reader. It does not apply the result: records keep every edge, including type-only and mocked ones, so a question such as which files a test imports gets the whole graph. `mockTaint()` gets its answer from the cached parse and no longer opens or re-parses test files, which matters in a repository with tens of thousands of them. A `mockTaint` given its own `callers` asks something the scan did not, so it still reads the file. `files`, `taintFile` and `taintTable` work as before. `updateSourceIndex` no longer runs a separate taint pass. The source index is now format 10, so an older segment is rebuilt rather than read without its mock columns. The module reader no longer treats a computed member (`vi[mock]`) as a mock, or a computed `['spy']` key as `{ spy: true }`.

## 0.6.0

### Minor Changes

- 1b4c0db: A changed file the record has no row for no longer runs the whole suite

  A changed path the record has no row or declaration for, and the graph does not
  list — a README, a fixture a test reads with `fs`, a script a test spawns — is
  listed in `unread` and selects nothing by itself. `unread` is a report: the skip
  list is `whole` less `entered` whatever it lists. `variance select` and
  `variance run --since` name those paths on stderr, and `variance select --format
  json` lists them under `unread`. A file the suite rests on without importing it
  goes in the `preconditions` option of the Vitest, Jest or Rstest integration,
  and a change to it then selects every test that declared it.

  A changed module with no instrumented row under any of its names — one the
  recording did not instrument, or one added since it — is walked to the files
  that import it along every runtime edge, never `type`, and each chain stops at
  the first test file or instrumented module it reaches. A module with a row but
  no probes is walked past, and the tests that declare it are selected. A test
  that mocked the changed module, or a file between it and the row, is cut. A
  stylesheet, image or JSON file is walked along `asset` edges, as before.

  Each importer answers for itself. A changed file whose importers the record
  measured only in part selects the tests of the measured ones: an importer with
  no row selects nobody and no longer voids what the chain beside it selects. A
  file known under two names, its source and its built twin, is answered when
  either name has a row, and each name selects the tests recorded under it.

  A bumped package is never `unread`. It is walked to every file that imports it
  at any distance; the measured ones select their tests, and one the record never
  measured selects nothing. Declaring that file as a precondition does not change
  this: a precondition selects on a change to the declared file's own text, not on
  a bump beneath it.

  `variance select` compares the install. It reads the lockfile at the diff's base
  and in the working tree, answers a bumped package through the files that import
  it, and declines to narrow when the lockfile cannot be compared. The lockfile
  and `package.json` are left out of `unread`, because the comparison has already
  said what moved. `variance run --since` reads the execution journal after the
  baselines and the file graph, and narrows past their whole-suite answers, except
  after a change to a `source.before` entry or an install it could not compare:
  the journal never saw either, so the run stays whole.

  `foldTestCoverage` keeps the instrumented rows where shards disagree about
  whether a module could be read. The tests another shard watched run that module
  keep their crossings and stay whole, rather than being demoted to incomplete and
  running at every selection; the tests that loaded the uninstrumented copy
  already declare it as a precondition.

  A workspace package imported only with `import type` is not a runtime import.
  The native scan records a package edge beside an unresolved bare specifier, with
  the kind it was read as, the way the JavaScript scan does, so a caller bridging
  workspace specifiers can tell an erased import from a loaded one. The record
  cache is discarded once, so a record the native scan wrote without those edges
  is read again rather than reused.
- c9a35ca: `@variance-authority/core/relate` exports are renamed, and the old names are removed

  The old names are removed, not kept as aliases:

  | Was | Is |
  |---|---|
  | `movedBy` | `affectedBy` |
  | `Reached` | `Affected` |
  | `MovedOptions` | `AffectedOptions` |
  | `movedBefore` | `changedBefore` |
  | `Reach` | `Traversal` |
  | `ReachOptions` | `TraversalOptions` |
  | `Reach.reached` | `Traversal.nodes` |
  | `Reached.reach` | `Affected.traversal` |

  `dependentsOf` and `dependenciesOf` return a `Traversal`, and `trailOf` takes
  one as its argument.
- 8adc864: Code that runs when a module loads no longer counts as covered by every test in the file

  A module's top level runs once per test file, while whichever test is running
  at the time. Before, every test in the file was recorded as covering it, so
  each line at module scope looked as covered as the function bodies in that
  module. The record now marks such a region as loaded and lists no test as
  covering it. `variance covering` works out, from the import graph, which tests
  loaded it, and leaves out test files that mock the module. When no import graph
  names a recorded test, for example a module that runs in the page and that a
  browser spec never imports, `variance covering` prints no tests for it rather
  than an empty list.

  Recordings written by an earlier version still read. Their module-scope regions
  are marked as loaded when the recording already said so, and are unmarked
  otherwise.
- 16f6dd6: Recorded file names are relative to the repository root

  The Jest, Vitest and Rstest wrappers, the Playwright reporter and the Storybook
  collector now name every file relative to the root of the git checkout the run
  starts in. Before, when the config was inside a package, file names were
  relative to Jest's `rootDir` or Vitest's `root`. A recording made from
  `packages/cart` said `src/cart.ts` where a diff says `packages/cart/src/cart.ts`,
  and the two never matched. `rootDir` and `root` still resolve the config and the
  relative paths in its options. Outside a git checkout, names are relative to the
  directory the run starts in.

  A recording that an earlier version made from a package-level config uses the
  old names, so record it again. `repositoryRoot`, exported from
  `@variance-authority/sense/test-selection`, returns the directory that file
  names are relative to.
- 1b4c0db: The Vitest integration declares the config file it ran under

  The config file Vite loaded, and the local modules it bundled into it, are
  preconditions of every test the seam records, beside the setup files. An edit to
  `vitest.config.ts`, or to a module it imports, now selects the whole suite; a
  package the config imports is read as the install. A configuration that lists
  projects declares its own file too. Jest and Rstest do not say which config file
  they loaded, so name it in `preconditions` there.
- 03984ae: A file whose imports could not all be read no longer widens selection

  A `require(name)` or `import('./' + name)` has no written target. The walk uses
  the edges that were read in such a file, and the recorded run answers the one
  that was not: the module loads under the test however it was named.
  `affectedBy` seeds only the changed files, the closure digest does not mark such
  a file volatile, and it does not void a deviation baseline.

  Removed, not kept as aliases: `Affected.opaque`, `Hole`, `ReachReport.opaque`,
  `ReachHole` and `ReachedComponent.throughUnread`.

### Patch Changes

- c92543d: Write the per-case execution index with far less time and memory

  When a Jest or Vitest run records cases, the reporter now writes the index
  beside the snapshot with the bounded fold, which reads the case journals a
  slice at a time. On a 200-case run over a thousand ambient modules it takes
  51 ms and 7 MB of heap, where building the whole index as objects first took
  440 ms and 158 MB, at the end of the run, when workers have used most of the
  memory. A late second frame for a case that had already settled is joined into
  that case, as before. An `executionFile` ending in `.json` is written as it was.
- 1b4c0db: `import { type X } from './x'` is a runtime import

  A request is `type` only when its statement is written `import type` or
  `export type`, and a re-export only when every statement naming it is. An import
  whose names are all marked `type` inline stays a runtime edge, because under
  `verbatimModuleSyntax` TypeScript emits `import {} from './x'` and the module
  loads; which setting applies is in a `tsconfig` the scan does not read. Each
  binding still says it is a type. The JavaScript and native scans agree on this,
  and the source index moves to version 7, so a parse cached under the old rule
  is parsed again rather than read.
- 76fdc4d: A test that mocks a module is no longer selected when that module changes

  `vi.mock` and `jest.mock` without a factory still evaluate the real module so
  the runner can shape the automock. The recording saw that evaluation, so an
  edit to a mocked module selected every test that had replaced it. Now, when the
  file graph carries the taints' shadows, a test is not selected for a module it
  mocks, or for anything it reaches only through the mock, whatever the record
  shows it crossing there: the test ran against the mock, and a mock whose shape
  drifted from the real module is a type error. `coveringChange` takes the graph
  as `relations` and drops those cases the same way. `auditTaints` reports
  `shadowed-but-entered` only when the test called into the real module, which is
  a mock that did not take; loading it to shape the automock is the mock working.
- 8adc864: `--no-git` reads source from disk, and a scan no longer makes Git fetch in a partial clone

  `variance select` and `variance reach` take `--no-git`: source is read from the
  disk rather than from Git's object store, and Git still supplies the diff. The
  scan walks directories instead of Git's list of tracked files, and cached parse
  results, which are keyed by Git object names, are not reused.

  Without the flag, a file whose object is missing from the local Git store is
  read from the disk. Before, in a partial clone, reading it made Git fetch the
  object from the remote.
- 83409da: A recorded test run spends less time in instrumented code

  The probe in each instrumented region now sets one flag the first time a test
  runs the region, where it used to increment a counter on every run. A hit costs
  1.2 to 3.2 ns, down from 2.6 to 4.4 ns. Recordings are byte-identical to the
  ones earlier versions wrote.
- fdc698f: Read the collector once per module, which makes recording under Jest much faster

  Jest runs each test file inside a `vm` context. Every global read there passes
  through an interceptor, and the probe read `globalThis.__VA__` on every hit.
  Now each instrumented module reads it once and keeps it. On the same loop in a
  `vm` context, 729 ms of probing drops to 12 ms or less. That read was most of
  what recording cost under Jest, and it was the likeliest reason recorded cases
  ran past their timeouts. Vitest runs in the main realm and gains nothing
  measurable.

  A collector must now keep the object on `globalThis.__VA__` for the life of the
  realm, and redirect counts through its `s` resolver instead of replacing it.
  Every collector shipped in this package now does. Jest's transform cache now keys
  on the probe text as well, so the first run after the upgrade instruments again
  rather than serving the old probe from cache.
- 1b4c0db: A recording made from a package is found from the repository root

  The coverage snapshot, the module-name table and every record store are now kept
  under the repository the directory you pass sits in, not under that directory
  itself. The recorders already wrote there. The readers — `variance select`,
  `variance covering`, the recording position `variance run` reports, and
  `testCoverageFile(root)` itself — used
  the directory they were given, so a suite recorded from a package-level config
  read as unrecorded from anywhere but that package, and a run from the package
  could not find a recording made from the root. `repositoryLayers(root)`, exported
  from `@variance-authority/sense/test-selection`, returns the directories a record
  of that repository lives in. The source index is still kept per scan root.
- 8adc864: Coverage from two builds that divide a file into different regions is recorded against the regions both have

  Two transforms of the same source can divide it into regions differently, so a
  region number from one build names a different region in the other.
  `variance journeys stitch` refused such shards, and folding them recorded
  coverage against the wrong region. Now a region that only one build has is
  recorded against the smallest containing region that every build has, or
  against the whole file when there is none. A changed line there selects every
  test that ran the containing region: the selection is wider, and it does not
  miss a test. `variance journeys finalize` and `stitch` print the files this
  applies to.

## 0.5.10

### Patch Changes

- 118424a: Write each case's journal when it settles, not when its file ends

  With per-case recording on, a test worker used to hold a counter array for
  every module every case touched until the file's `afterAll`. A file of a
  thousand cases held a thousand sets, mostly zeros. Each case is now written and
  dropped as soon as it settles, so a worker holds one case's counters and the
  file's union. What ran before the first test is closed in the first
  `beforeAll` as a record of its own, rather than copied. Work that outlives its
  case arrives as a second frame for that case, and the reader joins the two.

  Writing a journal reads each counter array once instead of six times, which
  takes the encoding of a thousand-case file 7.5 times faster, and byte for byte
  the same.

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
- c52c84f: Say why the native scanner did not load

  Finalizing or stitching journeys without the scanner now carries the loader's
  own message — a missing package, or a `dlopen` refusal naming the glibc symbol —
  instead of only naming the addon.

## 0.5.8

### Patch Changes

- afafa47: Build the native scanner without the tree-sitter grammars when they are what failed

  The five grammars are C parsers compiled by whatever toolchain the machine has,
  which is a way for the build to fail that the rest of the crate does not have. A
  failed build is now retried with them dropped, and says so loudly. Python, Rust,
  Java, Kotlin and Swift are then read by the JavaScript readers that are the
  implementation of record; nothing else about the scanner changes.

## 0.5.7

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.6

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.5

### Patch Changes

- Finalize and stitch journey artifacts through `variance journeys`

  `variance journeys finalize <journey-file>` seals a Jest run after Jest exits,
  and `variance journeys stitch <shard-file>... --into <journey-file>` assembles
  downloaded CI shards. Both commands work without `variance.config.json`. Sense
  no longer publishes a second executable for these operations.

## 0.5.4

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.3

### Patch Changes

- Publish the Jest journey finalizer

  The Sense package includes the `sense-journeys` command and its native fold and
  stitch implementation. A Jest journey run can now be finalized after Jest exits
  using the files installed from the package.

## 0.5.2

### Patch Changes

- 1e64a5a: Record Jest journey coverage after the test run

  Sense seals each Jest shard's per-test region journals before Jest exits. The
  `sense-journeys finalize` command folds one shard into a compressed artifact,
  and `sense-journeys stitch` combines downloaded shard artifacts on another
  machine. Both commands process the crossing relation in the native addon and
  write the result without transferring artifact bytes through the JavaScript
  heap.

## 0.5.1

### Patch Changes

- 65374a4: Add recording-only Jest journey coverage, deterministic assembly of shard artifacts,
  and one case scope for table-driven tests.

## 0.5.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.0

### Minor Changes

- da23004: The per-case execution index is columns, and fits a CI artifact limit

  `cases: true` wrote its index as JSON, one object per crossing. On three real
  projects that measured 31 to 37 bytes per crossing: a suite whose snapshot is
  0.3 MB left a 27.2 MB file beside it, and every CI has a cap on what a job may
  upload.

  It goes through the same column codec the snapshot uses — a dictionary, parallel
  integer columns, zstd run coding — and the same three projects now write 0.46 MB,
  0.46 MB and 0.21 MB. Nothing about the model changed: `decodeExecutionIndex`
  returns the index `encodeExecutionIndex` was handed, field for field, and the
  optional `loaded` keeps the difference between unsaid and denied.

  The default path is `<coverage file>.cases.bin`. An `executionFile` you name
  `.json` is still written as JSON, at the size JSON costs, for a reader that has
  to have it — and `variance covering` and `variance distill` read either, telling
  them apart by the first byte, so a cache recorded before this still answers.

### Patch Changes

- 838f187: Layering a recording onto a snapshot costs the change, not the snapshot

  Publishing decoded every module the snapshot held. A path string and an array
  per row, a map from path to rows, and one object a module — so a run that
  re-recorded ten modules of two hundred thousand still built two hundred
  thousand of each, and the heap a publish needed grew with the file it was
  layering onto rather than with the run it was layering.

  The rows are in code-unit order and so is the dictionary above them, so a
  path's place among the strings decides its place among the rows. Both searches
  are now binary and integer, the modules nobody touched are never decoded or
  compared, and the output's order is one `Int32Array` — four bytes a carried
  module — in place of the objects. Heap is flat in snapshot size at 6.6 to 7.7
  MB, where it was 9.4 MB at ten thousand modules and 18.6 MB at eighty
  thousand. What still scales is the columns themselves: total live memory falls
  from 1.07 to 0.89 MB per thousand modules.

  The bytes are the bytes. This is an optimization of a function that already
  existed, and the gate test still asserts the output is identical to the merge
  and encode it replaces.

## 0.3.0

### Minor Changes

- fc59417: A case survives Vitest 4, and an uninstrumentable file says why

  `withTestSelection({ cases: true })` reported *no tests*, wrote an execution index
  with nothing in it, and exited zero. Green, and empty — which is the worst shape a
  failure can take, because nothing downstream has any reason to look.

  The setup shim and the case runner were virtual ids this plugin resolved and
  loaded. Vitest 4 loads `setupFiles` and `test.runner` through Vite's module
  runner, which resolves them *before* any plugin of the test config is consulted,
  so both came back `ERR_MODULE_NOT_FOUND`. They are real files on disk now, at
  absolute paths, written under `.variance-authority/` and named after the run — a
  path needs no plugin on any major, and the per-run name keeps a watch run and a
  CLI run over one project from writing each other's shim. The files are removed once the
  journals are folded, though the directory itself stays; git does not track an
  empty directory, but add `.variance-authority/` to your ignore file if you would
  rather not see it, or if a crashed run leaves a shim behind.

  The `vitest` peer range was `^2.1.9`, so installing beside Vitest 3 or 4 either
  failed outright or required an override to attempt at all. It is now
  `^2.1.9 || ^3.0.0 || ^4.0.0`.

  **A `globalSetup` file is no longer instrumented.** It runs once, in the Vitest
  process, before any test environment exists — the shim that installs
  `globalThis.__VA__` is a `setupFiles` entry and has never run there. Instrumented,
  such a file threw at its first probe and took the whole suite down before a single
  test loaded. The resolved config names these files, so they are excluded by path
  rather than guessed at from their names.

  **And when a probe does find no factory, it says so.** `globalThis.__VA__ is not a
  function` names a missing global and leaves you to discover that the global
  belongs to a transform you did not ask for, on a file you did not expect it on.
  The error now names the file, says an instrumented module ran outside the
  environment the shim initialises, lists the contexts where that happens — a
  `globalSetup` file, a config file, a build script — and tells you to narrow
  `include`.
- 208fff4: An import is not a use

  Distill read an entered file and nothing smaller. Any crossing anywhere in a
  module made the file entered, at the shortest depth observed, and which region
  had been crossed was dropped on the way out. That is the reading test selection
  needs and it is built to over-answer: a module's initialization is attributed to
  every test that consumed the module, so a change cannot skip a test.

  Reduction asks the opposite question. `import { A } from './B'` runs `B`'s top
  level and nothing else — a spy answers in `A`'s place, or the branch that would
  have rendered it is never taken — and the module root is crossed either way. Run
  through a conservative file-level index, a component nothing rendered came back
  as source the test reached.

  `EnteredModule` is the second reading of the same crossings, one region at a
  time. `loadedOnly` marks a module whose every crossing is a consequence of
  loading it; `unentered` names the declarations the test never reached, at the
  outermost declaration that owns them. A module root has no caller a test could
  be, so both are derived from the region's own kind and ask nothing new of a
  producer. `ExecutionCrossing.loaded` is there for a producer that watched the
  evaluation and can say the same about a region below the root — a function the
  top level called — and that mark is believed over the kind.

  `formatDistillation` names those modules and the substitution to try against
  each. The substitution is a candidate: mocking takes the top level with the
  rest, and a top level that registers a handler, installs a polyfill or builds a
  singleton is one the test may be standing on. Make it, rerun the exact test,
  compare the witness.

  `parseExecutionIndex` also stops rejecting a module root. It required every
  block name to be non-empty, and a module root is the one region with no
  declaration to be named after — so no index carrying one could cross the CLI's
  JSON boundary.
- f075738: The native scanner arrives prebuilt, for three platforms

  The Rust scanner that reads, parses, resolves and records a cold checkout used
  to exist only where somebody had a Rust toolchain and had run the build. It now
  ships: `@variance-authority/sense-darwin-arm64`,
  `@variance-authority/sense-linux-x64-gnu` and
  `@variance-authority/sense-win32-x64-msvc` are optional dependencies of this
  package, your package manager unpacks the one your machine matches, and nothing
  compiles on install — there is no install script here and no `cargo` in the
  picture.

  **Three platforms, not nine.** An Apple Silicon laptop, a Linux x64 CI runner,
  a Windows x64 desktop. The list is short because it can afford to be: the
  TypeScript scanner is the implementation of record and the addon is an
  acceleration of it, held to the same answers by differential tests, so a Linux
  arm64 runner or an Alpine image builds the same source index and pays what the
  TypeScript scan costs. Adding a platform is a decision about a machine somebody
  ships from, not a completeness exercise.
- 05d6683: Changes before and beyond reach

  A run reads left to right: the harness starts it, the tests enter your code,
  your code goes out into the install and never comes back. Selection lives in the
  middle, and both ends were invisible for opposite reasons.

  The far right already arrived — a package is a node, a bump is a seed, the same
  backwards walk answers it. The far left is this. Nothing imports a
  `vitest.config.ts`, a setup module, a CI workflow or a `.nvmrc`, so no walk
  reaches one and the honest structural answer about a change to one is *no
  component moved*: a skipped suite over the file that decides how every test in
  it runs. A diff that was *wholly* outside the graph already widened. The hole
  was a config edited beside an ordinary source file, where the walk had a seed
  and answered confidently about a change it never looked at.

  `source.before` names those files, repository-root-relative, and a directory
  claims everything under it. What a declaration buys beyond its own name is
  everything below it: `beforeReach` in `@variance-authority/core/relate` walks
  *along* the arrows from each entry — the one question whose subject has no
  dependents — and collects the setup module, the fixture only that setup
  imports, and the packages the environment rests on. The descent stops at the
  first file `source.dirs` already covers, because that file has dependents and a
  change to it is answered exactly by walking them; everything below it is
  reached through it and does not arrive either.

  The two ends meet there. A `jsdom` bump is named by the install comparison,
  reaches `jest-environment-jsdom`, and reaches a config no file in the
  repository imports — a change beyond reach arriving before it.

  `scanRelations` takes `before` to seed those paths by name, since a harness
  lives above every directory a component scan is pointed at. A named path that
  is absent or has no reader is dropped rather than recorded unreadable: an
  unknown file seeds every walk forever, so a typo would otherwise widen every
  run in the repository. A declared entry the graph does not hold contributes
  only its own name, which is the whole answer for a `.nvmrc` and a symptom for a
  harness config, so the run reports it as a note rather than guessing.

  `source.before` requires `source.relations: true`.

### Patch Changes

- 4bf6682: A file two projects both ran is one row, and a region the transform inverted keeps its span

  Two ways a recording was lost rather than narrowed, both found by recording
  public repositories that were not written with this in mind.

  **A test file matched by two projects destroyed the whole record.** A runner's
  projects exist to run the same files under different conditions — Zod reruns its
  entire suite with ahead-of-time compilation turned on — and each project
  announces its own finished file for the same path. The snapshot is keyed by
  path, so the second announcement met a key the encode already held and threw
  `duplicate test coverage observation`. Nothing was written: one project
  configured that way and the run produces no record at all, on a workspace where
  selection would otherwise have been worth the most.

  The unit is the path, because the unit of the answer is the path — a selector
  names files to skip, and skipping one skips it in every project that matched it.
  `complete` is now the conjunction of the runs: a file whose compile-mode run
  stopped early recorded less than it reaches, and the other project passing does
  not put the missing regions back.

  **A region could close above where it opened.** Solid's JSX compiler hoists each
  element into a template above the function that returns it, so a region opening
  inside the template reads back to a lower original line than it started on. A
  source map answers one position at a time and both answers are right; it is the
  pair that has to be an extent. The record now clamps the pair, where before the
  inverted span was refused when it was read back — quietly, and only for the
  files a JSX transform had moved.

## 0.2.0

### Minor Changes

- 8efba76: A run that changed ten files stops rewriting the whole selection index

  Every run after the first reads the selection index, lays its own recording over
  it, and writes it back. At a repository's scale almost all of that was spent
  making objects nobody reads: a run that re-records ten modules of twenty thousand
  decoded six hundred thousand regions into a model, merged ten of them, and
  encoded the model back — the other 99.95% of the index materialized and
  re-serialized to arrive at the bytes it was read from.

  `layerTestCoverage` does the merge and the encode as one pass over the columns
  the previous snapshot is already stored in. A module the run did not touch is
  never made an object: its rows are copied column to column as integers, its
  strings blob to blob as bytes, and the only thing that happens to either is the
  renumbering the new dictionary implies. Objects are made for what the merge has
  to reason about — the tests, the modules this run re-recorded, and the carried
  modules whose text moved on disk. Over twenty thousand modules that is 1855 ms to
  616, and it is byte for byte the same file, which a gate asserts across every
  case the merge distinguishes.

  The columns are now zstd rather than brotli, at two levels, because the runs are
  two kinds of data. A varint run is a dense stream of small integers and answers
  to a long search; a run of the string blob is file paths and hex digests, which
  zstd finds most of at level 1 and nothing more of above it. Against the brotli
  quality 4 it replaces, over the same snapshot: 319 ms to compress became 120, and
  the file got 86 KB smaller.

  `zlib.zstdCompressSync` arrived in Node 22.15, so that is the floor these
  packages declare. The snapshot's layout version moved with the codec, which means
  an index written by an earlier build is refused at its header and rebuilt — one
  full run, and nothing a reader has to think about.
- d50e020: A selection says how far the change travelled, and a loop runs the near end
  first.

  `distanceByExecution` reads the coverage file once and returns the narrowing
  together with, per selected test, the shortest path from the change to it
  **through the modules that test entered**. A walk over the import graph alone
  returns a shortest path from any change to any file, and it is the wrong one: it
  runs through modules the test never loaded, and a distance has to be true of the
  graph and of the record at once. `relations` is the graph, `knownAs` gives every
  name one module is held under so a built copy and its source are one node,
  `faces` says where a unit's public entry point is, and `enumerated` says whether
  the graph read a given file's imports at all. `distanceFromView` is the same
  reading over a snapshot already open, and `nearestFirst` is the comparison every
  consumer sorts by.

  Each `TestDistance` carries a `bearing`. `precondition` is the change being the
  test's own source — zero hops, and the only zero there is. `direct` and
  `transitive` are one hop and more, every hop landing on a module's public entry
  point. `reach-through` is a hop that landed inside a unit instead, and names the
  importer, what it reached, and the entry it went around. `unexplained` is a test
  the change reached along no chain of imports it executed, reported only when the
  rest of that run is accounted for. `unmeasured` is the opposite of a finding —
  the graph could not answer — and carries `because` saying which; a walk that was
  never possible is absent rather than zero.

  `indexFaces` reads the entry-point convention most repositories keep — a
  directory with an `index` module — and `eitherFace` stacks a caller's own
  provider in front of it, which is where a manifest reader belongs.

  `atDistance` takes the selected tests a given number of imports from the change,
  `remaining` names what a range left behind, `groupByDistance` reports the whole
  reading as one group per hop count, and `distanceRange` reads `2`, `0-2` and
  `3-` and refuses anything else rather than quietly running one distance. The
  range is hop counts rather than positions in a list, so it asks the same
  question whatever the reading turned out to hold: a change whose nearest test is
  five hops away answers `0-2` with nothing. Start a near range at `0` — zero is a
  test whose own source the edit touched, and a range starting at one leaves it
  until last. A test nobody could place runs with the range that reaches the end,
  so `0-2` and then `3-` runs every selected file exactly once.
- 0718464: Jest selects from a change.

  `@variance-authority/sense/jest` wraps a Jest configuration the way the Vitest
  seam wraps one: the project's transformer — `@swc/jest`, `ts-jest`,
  `babel-jest` — still runs first, its setup files and reporters stay in their
  order, and probes land on the transformed text. The probes ride Jest's own
  transform cache, so an unchanged module is neither transformed nor parsed again
  on a later run or in another worker, and the record of what its probes mean
  lives beside the cached text under the same key. Each test file journals to
  disk from `afterAll`, the reporter folds the journals when the run completes,
  and the result lands in the snapshot the Vitest and journal seams write. A
  file two projects of one run transformed under different options has two
  inventories, and the reporter records it as one the build could not read rather
  than fold one project's tests into the other's regions.
- 0718464: Fold shard snapshots into the one a checkout reads.

  A suite split across CI jobs recorded one execution snapshot per job, and
  nothing shipped could make them one: `mergeCoverage` was reachable only through
  the Vitest seam, layers rather than folds, and no writer was public at all. The
  README said a job combines shards with it, and no job could.

  `@variance-authority/sense/test-selection` now exports `foldTestCoverage`, the
  order-independent union of shards that refuses by name when two were not one
  run, `writeTestCoverage`, the whole-or-nothing writer every seam lands through,
  and `mergeCoverage` itself. `variance journeys` takes shard snapshots as
  positionals, folds them, layers the result over what this checkout already
  holds — or writes it where `--into` says — and reads the suite it just made.
- 0718464: A changed file no probe can sit in is asked of the module that imports it.

  The record decides what a change reaches. A module nobody executed — every
  test that imports it mocks it, or nothing loaded it — has no row, and the tests
  that import it never ran a line of it: it selects nobody, and so does everything
  only it imports. A stylesheet, an image, a JSON file can hold no probe, so it
  never has a row, and whether a test ran it is a question about the module that
  imported it. `narrowByExecution` and `selectTestFiles` now take `relations` and
  walk from every changed file through `asset` edges — the stylesheets that import
  the stylesheet, the modules that import those, and no further — and select the
  tests that entered each module reached; a module reached without a row is dead.
  A file whose own edges the scan could not read may reach the asset by an edge
  nobody saw, so its tests are selected as well. `knownAs` looks the changed file
  and every module reached up under every name the journal holds them by. `unread`
  names the changed paths nothing recorded holds — no row, no precondition, no
  place in the graph — as a report rather than a widening: a suite that depends on
  a file that way declares it as a precondition.

  A diff is read the way `git` writes it. A pure insertion is placed after the
  line it follows, additions past the count of lines they replace are charged to
  the gap they open after the last one, a file the diff names without a hunk — a
  binary, a rename, a mode change — is charged whole, a quoted path is decoded,
  and the narrowest region on a changed line is measured over regions that have
  source, so the `else` nobody wrote never decides a line alone. A module the
  runner evaluates again after a registry reset keeps what it counted before it,
  a module a runner shares across files without isolation is counted for every
  file that consumed it, and what a module did while evaluating is credited to
  the files that entered it rather than to every file the run ran; a file that
  only reads a module another file evaluated is reached through `relations`. A line that
  opens or closes the narrowest region — the condition of an `if`, the props
  beside a one-line handler — is the enclosing region's line too, and charges it.

  The CLI's `--since` lists files from the merge base of the ref and `HEAD` to
  the working tree, untracked files included, so a branch behind `main` is not
  charged with what others merged and a watch loop is asked about the edit that
  was just saved; the hunks the journal reads are taken from the commit the index
  was recorded at, whose coordinates are the only ones its line ranges are in;
  a module the run did not load, carried from an earlier recording, has its text
  on disk compared with what its rows were recorded over, and every test that
  entered a module that has moved is marked partial rather than left standing on
  lines that are no longer there. A rename's hunks are read under the old name.
  Paths are read unquoted and under `a/` and `b/` whatever the operator's git
  configuration says, and the index is looked for at the repository root as well
  as the run's directory.

  The Jest seam instruments every project of a `projects` configuration and
  leaves a setup entry that names a package out of the preconditions; the Vitest
  seam does the same for its setup entries.

  The runtime's counter factory is installed before the project's own setup
  files — first in Vitest's `setupFiles`, and in Jest's `setupFiles` rather than
  `setupFilesAfterEnv` — so a setup file that loads an instrumented module finds
  it. Jest projects that name `@variance-authority/sense/jest-setup` by hand keep
  working; it installs the factory itself when nothing has.

  Every selection now says why. `because` names, per selected test, the changed
  region it entered, the precondition it is governed by, or the trail of importers
  it was found through. The CLI's `--since` hands its `relations` scan to the
  journal reader when the config asks for one.

### Patch Changes

- e546e21: A run that instrumented nothing says so

  A vitest project inherits neither plugins nor setup files from the configuration
  around it, so the wrap that looks right — one at the root, projects beneath it —
  transforms no product module. Nothing fails: the suite runs, the reporter runs,
  the snapshot is written. It says every test reaches no source,
  `narrowByExecution` reads that as an answer, and every selection made from it
  narrows to the empty set. The first sign is a green pipeline that stopped
  testing.

  The reporter warns on the one state that is indistinguishable from a clean run
  and is not one: zero modules instrumented across one or more test files. Said
  rather than thrown, because zero is legitimate — a run filtered to a single test
  file that imports no source has nothing to instrument — and the message names the
  two misconfigurations it usually is, since "0 modules" on its own does not say
  which. Zero test files is left alone; the runner has already said that.

  Wrap each project, and keep one wrap at the root for the reporter that folds the
  run. The README carries the shape.
- f4b328b: A run leaves behind what its suite looked like, in bytes another checkout can read

  A run report answers about *this run*. Nothing answered about the suite from
  somewhere else: which components exist, which subjects hold them, which of them
  has an example of its own, and every name the run indexed. A branch asking any
  of that against `main` had nothing to ask, because `main`'s answers were computed
  on a machine that has since gone away — which is why *this component is not
  covered anywhere* was a question with no reader, and why a second run could only
  re-derive what the first already knew.

  `@variance-authority/report/suite-index` is that artifact. `suiteIndexOf` takes
  the baseline-bearing half of a report — the census, the subject denominator it is
  counted against, and the lexicon — and `encodeSuiteIndex` writes it as one
  segment, with `readSuiteIndex` and `writeSuiteIndex` beside the report's own file
  functions. The other half of a composition does not travel: `movements` is what
  moved since a comparison nobody else made, and `divergences` and `echoes` are
  readings of one commit's snapshots. None of the three is a fact about the suite.

  It carries the commit it was written at and nothing else about where it is, which
  is the rule the selection index already settled — a commit answers *what changed
  since this was written* exactly, and a timestamp says when a machine was rather
  than where a tree was. An index that cannot name itself is the honest record of a
  run that could not, and a reader holding one has nothing to diff.

  It is not JSON. A lexicon is the same few thousand strings written once per
  subject that holds them, and in JSON the repetition *is* the payload. Interned
  once and referenced by number it stops being one, and equal facts encode to equal
  bytes — a sorted dictionary, so a cache that keys on content actually hits.

  `@variance-authority/core/segment` is the arithmetic underneath: named columns,
  alignment, interned strings, and the validation a decode performs before it
  believes a file. A column's width comes from the array's own type, so a mismatch
  is a compile error rather than a decode against the wrong stride, and a malformed
  reference rejects the whole file — a segment is a cache or a baseline, both of
  which may be rebuilt, and half of either is worse than neither. The source index
  now reads and writes through it and keeps its own bytes; what it still owns is the
  part that is about source.
- 0718464: A layered run no longer turns a test's *entered this region* into *did not*.

  A subset run — one file by hand, a watch loop — layered over a full one
  positions the index where the subset stands and drops the crossings of every
  test it did not re-record on every region it rewrote, while still calling those
  tests whole. The next diff of such a region then skipped the one test known to
  have reached it. `mergeCoverage` now carries such a test incomplete: it runs at
  the next selection regardless of what changed, and that run records it whole.

## 0.1.1

### Patch Changes

- fe578c8: Record one coverage row for a subject the run read twice.

  Stabilization reads a subject again whenever the first read was not trusted, so
  a changed or unstable subject reaches `recordExecution` twice. It built one
  `CoverageTest` per observation and keyed them by owner, and the encoder refuses
  to intern two rows under one name: every second run of a moving Storybook suite
  died with `duplicate test coverage observation` and wrote no journal, which is a
  selection index that silently stops existing exactly when the suite starts
  moving.

  `recordExecution` now folds its subjects through `joinObservations` before
  anything reads them — the same join `@variance-authority/playwright-test`
  already applied at its call site and `@variance-authority/storybook-collector`
  did not. Folding inside the recorder rather than in each collector is what makes
  the one-row-per-owner invariant hold for collectors not yet written.

## 0.1.0

### Minor Changes

- 9587133: Stamp the coverage index with the commit it was recorded at, and read the module
  row that says the build never parsed a file.

  There is one master branch; every other checkout is that branch plus a diff, or
  minus one where it is behind. So the index now carries one field — the commit it
  stands at — and the distance from it is `git diff` and the working tree. Nothing
  is walked, nothing is scored, and a recording made outside a checkout carries no
  commit, which is the honest record of an index that cannot say where it is.

  `instrumented: false` was written to disk and read by nobody at selection time. A
  module the build could not parse has no blocks, so a changed line inside one
  selected the empty set and returned it as an answer — a subject that entered the
  file was skipped on the strength of a measurement that was never taken. That row
  is now read as the silence it is: the file comes back under `unread`, and
  selection widens the way the shape of the column always promised.

  Recording no longer refuses when the index it is about to write over cannot be
  decoded. That read happens under the index lock inside a runner's teardown, and
  refusing there stopped every later run from recording anything until somebody
  deleted the file by hand.
- f09528d: Carry announcements and coverage on one medium, under one execution id.

  A run said two kinds of things about the same execution and had two ways of
  saying them: journeys reported coverage, events announced decisions, and each
  had its own idea of where home was. Configuring one did not configure the other,
  and a service that could talk about what it decided still could not say what it
  executed.

  `@variance-authority/wire` is that one medium. It resolves the carrier from the
  realm — a sink the driver installed, for a server the suite started inside
  itself, or a loopback return address the request arrived with on a cookie — so
  the same `collectEvents()` and `collectJourneys()` calls serve a page, a service
  in another process, and an in-process server without knowing which they are in.
  Told neither, a participant reports to nobody, which is what a request the run
  did not drive should do. The return address is refused unless it is `http:` on
  loopback, because whoever is talking to the service writes that cookie.

  Two guarantees ride the one wire, chosen by what a loss costs. An announcement
  is fire-and-forget with per-endpoint ordering: a lost one is a wait that times
  out loudly in the driver, holding the diagnosis. A coverage account is
  acknowledged and retried: a lost one is a test silently skipped on the next run,
  so a head counts what it lost and carries the count on later accounts, and a
  head that lost everything is silent, which already retires the run.

  Nothing at this level writes a file. A service is handed a `Cookie` header
  naming the execution and where to answer, and nothing else; the driver alone
  writes the coverage index.
- cfb333d: Record what a driven page executed, so Storybook and Playwright select like Vitest.

  The execution selector had one origin: a Vitest run instrumented its own modules
  and wrote them down in the same process. A page cannot do that — the names and
  spans that make a block ordinal mean something are produced by whichever process
  ran the bundler, and for a driven run that process finished on Monday. So the
  two halves are now written separately and joined by the driver.
  `testSelectionProbes()` instruments product source in the adopter's own build
  and persists the block inventory; the collector it hoists counts crossings in the
  page; `recordExecution` merges drained journals into the same coverage
  index, with the same probes and the same ordinals.

  `@variance-authority/storybook-collector` records with `tests`, where a story is
  its own owner because this tool shows one at a time.
  `@variance-authority/playwright-test` records with the `varianceExecution`
  fixture option or `tests` on `createVariance`, where every observation in one
  spec file joins that file, because the file is the runner's unit of execution.
  Module-kind blocks go to every subject the run drained, since a module
  initializes once per page and charging it to whichever subject was first would
  leave the rest unselected by an edit they all read. Workers merge under a lock on
  the index. A missing inventory, a foreign probe recipe, and a page with no
  collector each record nothing and say why.

### Patch Changes

- 48d32eb: Select the tests a changed file governs, not only the tests that entered it.

  Selection asked coverage which module a changed file is and stopped when there
  was none. A test file is never a module — nothing enters a test — so editing or
  adding one selected nothing, and a CI job following the documented workflow ran
  zero tests on a commit that was entirely new tests. A declared `preconditions`
  entry is never a module either, so changing the runner configuration that governs
  every test also selected nothing. Both were silent: an empty list and a green
  run. A changed file with no module now selects every test whose recorded
  preconditions name it.
