# Selection wiring: what the run rests on, and what it costs

Read this when a selection came back whole, when a config file you changed
selected nothing, or when a recorded run times out.

## Declare the files the run rests on

Some files decide how every test runs and are imported by nothing: the harness
config, the setup it loads, the bundler setup, the Node version, the CI
workflow. No walk reaches them, so a diff that changes one beside an ordinary
source file narrows as if it had not. Naming them is a one-time inventory, and
it is a job for you rather than for a rule: which paths govern a run is a fact
about the repository, and every heuristic that guessed was both too wide and too
narrow on the same diff.

Take it in this order, and read rather than assume:

1. **The harness.** Whatever starts the suite: `vitest.config.*`,
   `jest.config.*`, `playwright.config.*`, and any file they extend. Confirm
   from `package.json`'s `scripts` which one runs, and follow a `--config` flag
   if there is one.
2. **What the harness names but does not import**: `setupFiles`,
   `globalSetup`, `setupFilesAfterEnv`, `testEnvironment`, `moduleNameMapper`
   targets. A config that `import`s its setup already covers it; one that names
   it as a string does not, so that path is its own entry.
3. **The build the tests run through**: `vite.config.*`, `next.config.*`,
   `webpack.config.*`, `babel.config.*`, `postcss.config.*`,
   `tailwind.config.*`, whichever the suite goes through. A formatter or linter
   config does not belong here; nothing it says changes a render.
4. **The environment**: `.nvmrc`, the file behind the `engines` block if there
   is one, the CI workflow directory, a `Dockerfile` the suite runs inside.
5. **Nothing else.** A README, a changelog, an editor setting and a fixture JSON
   are not entry points. Adding them buys whole runs and no information.

Write them into `variance.config.json` as repository-root-relative paths. A
directory claims everything under it:

```json
{
  "source": {
    "dirs": ["src"],
    "relations": true,
    "before": ["vitest.config.ts", "vitest.setup.ts", ".github/workflows", ".nvmrc"]
  }
}
```

`source.before` needs `source.relations: true`: what a declared entry point adds
beyond its own name is everything below it, and that is a walk down the file
graph.

Then check the answer rather than trust the list. Run a selection over a diff
that changes one of the named files and one ordinary component, and confirm the
run comes back whole. A note naming entries the scan does not have is normal for
a `.nvmrc` or a workflow, which have nothing under them to read. It is not
normal for the harness config: it means the setup files below it still narrow to
nothing, and the usual cause is a path that does not exist or an extension the
scan has no reader for.

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
  it: `source.before` for `variance run --since`, and a precondition for the
  test integrations. The Vitest integration declares the config file Vite loaded
  and the local modules it imports; Jest and Rstest take the config in
  `preconditions`. Undeclared, a config edited beside a component file is
  invisible.
- A file below a declared entry point, such as a setup module or a fixture only
  that setup imports, does not narrow either, and neither does a package the
  harness rests on. A `jsdom` bump that changes a Jest environment a config
  names is one trail, and no file in the repository spells the word.

When an integration reports that it kept the whole suite, read the path it
names. That is a wiring fact about the project, and usually a fixable one.

Absence is the other direction, and it widens nothing. A changed path the
recording has no row for is asked of the import graph when you pass
`relations`, and the nearest measured files that import it select their tests.
One the graph does not list, such as a README or a fixture, appears under
`unread` and selects nothing. One it lists whose importers include nothing
measured selects nothing and is not reported. A bumped package selects the tests
of its measured importers; one with none selects nothing and is not reported.

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
   and the setup file the wrap adds has two. The flag selects Node's older
   implementation, which releases that memory as usual. Jest 29 does not grow
   this way.
3. Lower the worker count (`--maxWorkers` in Jest and Vitest). A recording run
   with fewer workers still pays for itself: the recording it writes shortens
   every later run.
4. Under Jest, set `workerIdleMemoryLimit` in the configuration, so a worker is
   restarted once it grows past that size. That limits the growth without
   lowering concurrency.

On a 60-file Jest suite, run in band, the heap after a full garbage collection
at the last file was:

| Run | Default | `--no-async-context-frame` |
|---|---|---|
| Plain, one empty `beforeAll` per file | 344 MB | 79 MB |
| Recorded | 422 MB | 95 MB |
| Recorded, per case | 471 MB | 90 MB |

Do not remove the wrap to make a run pass, and do not change the repository's
worker settings or Node options without saying so. Report the memory figures
instead.
