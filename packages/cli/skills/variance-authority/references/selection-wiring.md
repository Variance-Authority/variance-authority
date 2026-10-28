# Selection wiring: what the run rests on, and what it costs

Read this before you write a suite's `before`, `ignore`, `relations` or `precision` in
`variance.config.json`, when a selection came back whole, when a config file you
changed selected nothing, or when a recorded run times out.

## Declare the files the run rests on

Some files decide how every test runs and are imported by nothing: the harness
config, the setup it loads, the bundler setup, the Node version, the CI
workflow. No walk reaches them, so a diff that changes one beside an ordinary
source file narrows as if it had not. Naming them is a one-time inventory, and
it is yours to take: which paths govern a run is a fact about the repository.

Take it in this order, and read rather than assume:

1. **How the suite reaches the code.** A test that imports what it tests — a
   unit test, a component test, a Playwright component test that mounts — is
   reached by import, and the suite keeps `relations`, its default. A test that
   drives the code from another process — Playwright or Cypress over a running
   app or a built Storybook, which names a story by the id in its URL — has no
   import to walk, so give the suite `"relations": false`. Its record then
   answers for every file it measured, and the build it drives must carry
   `testSelectionProbes()` for it to measure any. A file it did not measure,
   such as one added after the recording, selects nothing and `select` names it
   declined.
2. **The harness.** Whatever starts the suite: `vitest.config.*`,
   `jest.config.*`, `playwright.config.*`, and any file they extend. Confirm
   from `package.json`'s `scripts` which one runs, and follow a `--config` flag
   if there is one.
3. **What the harness names but does not import.** A config names these as
   strings, and a string is not an import. The integrations already record some
   of them on every test they ran: the Vitest integration records the config
   file, the local modules it imports, `setupFiles`, `snapshotSerializers` and
   the `diff` file; the Jest integration records `testEnvironment`,
   `setupFiles` and `setupFilesAfterEnv`, when they are files of the
   repository; the Rstest integration records `setupFiles`. The rest is yours:
   `globalSetup` in every runner, Jest's `globalTeardown`, Jest's and Rstest's
   config file, `moduleNameMapper` and `transform` targets, and everything a
   Playwright config names. Name a recorded file too when its change must run
   every test file: a recorded file reruns only the recorded tests that declared
   it, and a `before` entry also runs the tests no recording has seen.
4. **The build the tests run through**: `vite.config.*`, `next.config.*`,
   `webpack.config.*`, `babel.config.*`, `postcss.config.*`,
   `tailwind.config.*`, whichever the suite goes through. For a suite over the
   app, the app's entry, such as `src/main.tsx`. For a suite over Storybook,
   `.storybook/`, which holds `main.*`, the preview and `preview-head.html`. A
   formatter or linter config does not belong here; nothing it sets changes a
   render.
5. **The environment**: `.nvmrc`, the file behind the `engines` block if there
   is one, the CI workflow directory, a `Dockerfile` the suite runs inside.
6. **Nothing else.** A README, a changelog, an editor setting and a fixture JSON
   are not entry points. Adding them buys whole runs and no information.

Write them into `variance.config.json` as repository-root-relative paths. A
directory covers everything under it, and every file under it is walked as an
entry point:

```json
{
  "before": [".github/workflows", ".nvmrc"],
  "suites": {
    "unit": { "kind": "unit", "before": ["vitest.config.ts", "vitest.global-setup.ts"] },
    "stories": {
      "kind": "e2e",
      "relations": false,
      "before": ["playwright.config.ts", "e2e/global-setup.ts", ".storybook"]
    }
  },
  "source": { "dirs": ["src"], "relations": true }
}
```

The top-level `before` is what every suite rests on; a suite's own is its runner
config and setup. What a declared entry point adds beyond its own name is
everything below it, a walk down the file graph. `variance select` reads both
lists for the suite it reads; `variance run --since` reads the top-level one and
needs `source.relations: true` for it.

Then check the answer rather than trust the list. Run `variance select` over a
diff that changes the setup file, and confirm it skips nothing and names the
file; run `variance run --since <ref>` over a diff that changes a workflow and
one ordinary component, and confirm the run comes back whole. For a suite with
`"relations": false`, after a recorded run, run `variance select --suite <name>` over a diff that adds
a source file, and confirm it names the file declined rather than selecting by
import. A note naming entries the scan does not have is normal for
a `.nvmrc` or a workflow, which have nothing under them to read. It is not
normal for the harness config: it means the setup files below it still narrow to
nothing, and the usual cause is a path that does not exist or an extension the
scan has no reader for.

## Declare what a suite ignores

A suite can import a file that cannot change any of its results. A unit suite
under jsdom imports stylesheets and images with its components and paints
nothing. Without an `ignore`, the graph sends a changed `.css` to every test
that imports the component. Give such a suite `"ignore": ["**/*.css", "**/*.png"]`,
with globs from the repository root that match dotfiles; a `!` pattern takes a
file back out. A matching changed file loses its regions, its import and asset
edges and its `before`, and `select` lists it under `ignored`. A test that
declares it, as a precondition or through a `/// <depends>` in the module it
tests, still runs when the record saw it enter that module; a declaring module
the record holds nothing for goes where any unmeasured file goes, to its
importers or, with `relations: false`, to `declined`. Each suite uses only its own list, so a visual suite over the
same components still selects on the stylesheet. `variance run --since` reads the
list of the suite it runs for (`--suite`, or the only one declared) the same way. A file a test reads as data,
such as a CSS module whose class names a snapshot prints, takes a
`/// <depends>` in that test rather than leaving the `ignore`.

## Declare a suite's precision

A suite's `precision` says how precisely selection decides which tests to
skip, coarsest first: `file` (every recorded test that imports a changed
file, through the graph, and every test `file-use` runs), `symbol` (the same
walk through only the importers of the exports the change moved, and every test
`file-use` runs), `file-use` (every test that loaded a changed
file), `function-use` (every test that entered the function a changed line is
in, with the top level read as at `region-use` and each charged region
widened to its function: a changed top-level value runs every test that entered
a function reading it, and a change that runs as the module loads runs every
test that loaded the file), `region-use` (the default: every test that entered the changed region).
A step reads only what the run recorded, and `withTestSelection`'s `mode`
decides that (below): a step finer than the record answers as the finest step
the record holds.

Leave it unset unless the person adopting selection asks to start coarser; the
step is theirs to choose, and they move it finer when the runs have earned it.
`file` and `symbol` read the import graph, so a suite with `"relations": false`
cannot declare them and the config is refused. Each step runs every test a finer
step runs. To compare steps for one change, run `variance select` once per
step; nothing composes them.

## Choose what the run records

`withTestSelection` takes the same recording options under Vitest, Jest and
Rstest. Record at the step the suite declares and no finer, because each step
down costs run time. Added to this repository's unit suite under Vitest:

| `mode` | the record holds | finest `precision` it answers | added |
|---|---|---|---|
| `'loads'` | the modules each test file loaded; one line after each module, nothing parsed, no cases | `file-use` | about 3% |
| `'entries'` | the functions each case entered | `function-use` | about 7% |
| `'presence'` (default) | the regions each case entered | `region-use` | about 9% |

The other recording options:

- `cadence` (on): the test line that first reached each region. `false`
  leaves test files untransformed.
- `continuations` (off): a case keeps the asynchronous work it started after
  it returns. Turn it on for a concurrent suite, or one whose work outlives
  its cases.
- `placement` (`'after-transforms'`): `'before-transforms'` probes the file as
  read, for a run whose transforms only strip types or JSX. Keep the default
  when a compiler that reads syntax, such as React Compiler or Compiled, is in
  the run.
- `unprobed`: modules that take the `loads` line instead of probes, inside a
  finer recording. Jest takes globs; Vitest and Rstest take a predicate.

Under `'loads'`, `cadence`, `continuations` and stories do not apply. A run
fails rather than lay itself over a record made under another `mode`:
when you change `mode`, give the run a new `coverageFile` or delete the
old record.

## What selection refuses to narrow

Selection over-includes on purpose, because skipping a test that should have run
produces a green report over work nothing checked, and silently. Expect these:

- A test file that changed selects itself.
- A run that cannot list its changed files does not narrow.
- A lockfile that cannot be read, or cannot be read at the base revision, does
  not narrow. A comparison that failed is not a comparison that found nothing.
- A change to the harness, the bundler config or the Node version does not
  narrow: nothing imports them, so there is no edge to walk and no answer
  smaller than the whole suite. It is only *noticed* when something declares
  it: `before` in `variance.config.json`, and a precondition for the test
  integrations. The Vitest integration declares the config file Vite loaded,
  the local modules it imports and the configured setup files; all three
  integrations take further files in `preconditions`, and Jest and Rstest need
  the config named there. Undeclared, a config edited beside a component file is
  invisible.
- A file below a declared entry point, such as a setup module or a fixture only
  that setup imports, does not narrow either, and neither does a package the
  harness rests on. A `jsdom` bump that changes a Jest environment a config
  names is one trail, and no file in the repository spells the word.
- A module a probe cannot sit in does not narrow below the test files that
  loaded it. A module whose functions a test hands to `page.evaluate` is one:
  the function runs in the page, and its first probe throws there. Name it in
  the integration's `unprobed` option (a predicate in Vitest and Rstest, globs
  in Jest). It then runs with a mark at the end of its text and no probe, so
  the record holds no line of it, a change to it selects every test file that
  loaded it, and `variance covering --file` names those files. Left out of
  `unprobed`, it fails the run where the probe lands.
- A module a test builds into a bundle and injects into a page is loaded by no
  test file, so no mark reaches it. Declare the bundle's entry point in the
  `before` of the suite that injects it: a change to any file below that entry
  then selects the whole suite. With no entry, the change is answered by the
  import graph, which does not see the injection.

When an integration reports that it kept the whole suite, read the path it
names. That is a wiring fact about the project, and usually a fixable one.

Absence is the other direction, and it widens nothing. A changed path the
recording has no row for is looked up in the import graph when one is passed,
and the nearest measured files that import it select their tests. One the graph
does not list, such as a README or a fixture, appears under `unread` and selects
nothing: if the suite reads that file without importing it, declare it as a
precondition. One it lists whose importers include nothing measured selects
nothing and is not reported. A bumped package selects the tests of its measured
importers; one with none selects nothing and is not reported. In a suite with
`"relations": false` the graph is not asked: an unmeasured path selects nothing
and is reported as declined.

## Ask one stage without a diff

`variance select` runs every stage in the order above. When the files are
already known, or invented for a simulation, call the stage itself from
`@variance-authority/sense/test-selection` over an open record:
`testsLoadingFromView(view, paths)` for every test that loaded each path,
`testsEnteringFromView(view, change, { precision })` for invented ranges,
`testsDeclaringFromView(view, change)` for preconditions,
`importersFromView(view, change, { relations })` and `dependsReachFromView` for
the graph's walk, `readRowlessFromView` for a module
the record never measured, and `changeOfFiles(paths)` to build the change.
Each answers `{ entered, because, unanswered }`, reads no git, and reads the
checkout only through `root`; `unanswered` is never a reason to widen. Pass
`sourceAt` for the frame check and the parser's reading; lines with no hunks
are charged as given and read by no parser. One file can be answered by a row
and a declaration at once, so each stage takes the part of the change it reads
in the composition: cut by `ignoredChange` first, the entering and rowless
stages take what is kept, `testsDeclaringFromView` the whole change,
`importersFromView` `changeOfPaths(kept, read.unanswered)`, and
`dependsReachFromView` what is ignored. The union of what they enter is what
`narrowByChangeFromView` answers, and that is what `narrowByExecution` runs; by
hand the precondition table is read once per walking stage, composed once, and
the composed `because` names the stage of each reason. Without `root` no
stage reads a package's `sideEffects`. The stages before the route, an install's moves and
the harness, are `beyondReach` and `beforeReach` in
`@variance-authority/core/relate`.

## A recorded run costs memory, not time

Recording changes the suite's wall-clock time very little, but every module a
test loads runs with probes in it, so each worker needs more memory. On a
machine already near its memory limit with the plain suite, the recorded suite
can push it over: workers swap or are killed, and the symptom is tests that time
out, often at several times their usual duration, rather than an out-of-memory
error.

When a wrapped run times out or loses workers and the same suite without the
wrap does not:

1. Check memory before you read the timeout as a slow or broken test. Compare
   peak memory summed over all workers, wrapped and unwrapped, at the same
   worker count.
2. Under Jest 30 on Node 24 or newer, run the tests with
   `NODE_OPTIONS=--no-async-context-frame` and measure again. Jest 30 calls
   hooks and event handlers inside an `AsyncLocalStorage`, and with the
   implementation Node uses by default, the memory of every finished test file
   stays in the worker until the heap is close to its limit. So each worker
   grows to the limit whether or not the suite is recorded; the probes make each
   file larger, which gets it there sooner. One `beforeAll` per file is enough,
   and the setup file the wrap adds has two hooks. The flag selects Node's older
   implementation, which releases that memory as usual. Jest 29 does not grow
   this way.
3. Lower the worker count (`--maxWorkers` in Jest and Vitest). A recording run
   with fewer workers still pays for itself: the recording it writes shortens
   every later run.
4. Under Jest, set `workerIdleMemoryLimit` in the configuration, so a worker is
   restarted once it grows past that size. That limits the growth without
   lowering concurrency.

Do not remove the wrap to make a run pass, and do not change the repository's
worker settings or Node options without saying so. Report the memory figures
instead.
