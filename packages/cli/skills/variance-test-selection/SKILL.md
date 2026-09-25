---
name: variance-test-selection
description: Use when choosing which tests to run after a source edit, which of them to run first, or when reading a distance, reach-through, unexplained or unplaced finding from a test-selection snapshot.
---

# Test selection and distance

When a repository has configured the Vitest or Jest integration, a suite run
records which test file entered which region of which module. Test selection
reads that record back and answers two questions about an edit: **which recorded
tests it reached**, and **how far it travelled to each one**. Both are answers
about what executed, not predictions from a build graph.

Use this to shorten the loop. It does not replace the gate: the full suite is
the only green that counts, and every narrowing here is a smaller claim than it.

## Preconditions

All of these must hold before any command below. Check them in this order; the
first that fails is the whole answer.

1. **Node >= 22.15.** `@variance-authority/sense` declares that engine.
2. **The package is installed.** `node -e "import('@variance-authority/sense/test-selection').then(()=>console.log('ok'))"`
   from the repository root. If it fails, install it as a devDependency —
   `yarn add -D @variance-authority/sense` (or `npm i -D`). This package has no
   binary. The commands below come from `@variance-authority/cli`, which reads
   the same snapshot; check for it with `npx --no-install variance --version`.
3. **The runner is wrapped.** `withTestSelection` from
   `@variance-authority/sense/vitest`, or the Jest seam from
   `@variance-authority/sense/jest`, must already be in the runner config.
   Without it no run records anything. Wiring it is product work, not something
   to add during an unrelated task.
4. **A suite run has happened since the wrap.** Recording is a side effect of a
   wrapped run; there is no separate build step.
5. **The working directory is the repository root** — the same absolute path the
   recording run used. The snapshot is keyed by that path.
6. **In this repository only:** `tsc --build` must have run, because
   `tools/test-since.mjs` imports the built `dist`, not `src`.

The snapshot lands at
`<cache>/test-selection/<digest of the checkout's absolute path>/coverage.bin`,
where `<cache>` is the cache (https://variance-authority.dev/docs/cache).
`testCoverageFile(root)` returns that path — ask it rather than composing it. A
git worktree writes to `.work/<its own digest>/` beneath the primary checkout's
directory and reads both layers.

### What invalidates the snapshot

- **Nothing on a timer, and nothing in git.** The file lives outside the
  checkout, so `git clean` does not reach it and a branch switch does not touch
  it.
- **A wrapped run re-records.** Each run layers over what it finds, per test
  file. That is the only refresh there is.
- **Per test file, automatically:** changing a test file's own source, its setup,
  or a declared precondition starts a new generation for that file and retires
  its inherited crossings. A carried module whose text on disk no longer matches
  its rows marks every test that entered it partial, and a partial observation
  can never justify a skip.
- **Whole, only by being unreadable.** A missing, corrupt or foreign-layout
  snapshot is treated as absent — the suite runs whole, which cannot produce a
  wrong skip. To force that deliberately, delete the digest directory
  `testCoverageFile(root)` names and run the suite once.

## From the command line

When `@variance-authority/cli` is installed, these answer without a script. None
of them reads `variance.config.json`.

```bash
variance index                                  # publish the file graph the others read
vitest run $(variance select --format vitest)   # skip what the change cannot reach
variance reach --since origin/main              # files a diff reaches over imports alone
variance covering --file src/total.ts --line 48 --hops    # the cases that entered one line
variance covering --since origin/main --format refs       # every changed region and its cases
```

- **`select` prints a skip list, never a run list.** An empty stdout runs the
  whole suite. Every sentence about the reading goes to stderr, so `$(...)` only
  ever picks up paths. `--format json` gives the counts and the reason a
  reading widened.
- **`reach` needs no recording**, and reads JavaScript, TypeScript, Python, Rust,
  Java, Kotlin and Swift. It prints a run list, so it exits `2` with an empty
  stdout rather than print a short one.
- **`covering` answers per case.** A line answer names each test file once, as
  `total.test.ts — 2/3`: two of its three cases entered the line. `--hops` adds
  each test file's import hops and sorts nearest first. It costs a scan of the
  tree, so ask for it per question, not per edit.
- **`covering` says what a change moved.** `--since <ref> --against <record>`
  compares the case index a base recorded; `--cases last` compares the last run
  with the one before it. A region is `lost` when no case walks it any more,
  `hidden` when the case that could have reached it stopped, `thinned` when one
  case walks it where several did, and `gained` when a case walks it where none
  did.
- **`--format refs`** numbers each case once and names every range's cases by
  number. It is the shortest answer to hand another agent.
- **Nothing recorded** is refused with exit `2`, and under `--format json`
  stdout carries `{"refused":"unrecorded"}`. Asking again changes nothing until
  a wrapped run has happened.

Use the API below for what the commands do not print: a distance per test, the
`because` trail, or a diff that is not a ref.

## Establish whether the project has an execution entry point

A repository may wire the API into its own script. Read `package.json`'s
`scripts` and the repository instructions first. Do not assume a command name or
runner option: `test:since` and `--at-distance` belong to *this* repository's
contributor tooling (`tools/test-since.mjs`) and are not installed by
`@variance-authority/sense`.

Use a repository-owned command only when that repository defines and documents
it. Its orchestration must own the current test inventory and dispatch each path
to the Vitest, Jest, Playwright or other host that can execute it.

If there is no script, call the API directly — that is the legal move, and it is
the whole of it. Do not hand-roll a selection from `git diff` and a grep for
imports; the answer depends on the execution record, which only the snapshot
holds. Reading the snapshot is not building orchestration. Writing an inventory,
a skip-list subtraction and a runner dispatch is, and that is the line.

### One complete invocation

Ask the snapshot what a diff reached, and how far. Run this from the repository
root, as `.mjs`, with the package installed:

```js
import { execFileSync } from 'node:child_process';
import {
  distanceByExecution,
  groupByDistance,
  recordedCommit,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';

const root = process.cwd();
const file = testCoverageFile(root);
const commit = await recordedCommit(file);

// Any unified diff over the same checkout. The hunk line numbers must be in the
// coordinates of `commit` — that is what the snapshot's ranges are numbered in.
const diff = execFileSync('git', ['diff', commit], { cwd: root, encoding: 'utf8' });

const { narrowing, distances } = await distanceByExecution(file, diff);
console.log(narrowing.whole.length, narrowing.entered.length, narrowing.unread);
console.log(groupByDistance(distances));
```

Run against this repository's own snapshot, over the diff of one commit that
edits `packages/core/src/attribute/stack.ts`, that printed:

```text
whole: 406 entered: 3 unread: ["packages/sense/src/test-selection/index-lock.ts"]
because[0]: {
 "test": "packages/core/src/attribute/call-site.test.ts",
 "via": [
  { "kind": "region", "file": "packages/core/src/attribute/stack.ts",
    "name": "", "path": "module", "startLine": 40, "endLine": 242 }
 ]
}
distances: [
 { "test": "packages/core/src/attribute/stack.test.ts", "bearing": "precondition",
   "hops": 0, "from": "packages/core/src/attribute/stack.test.ts",
   "trail": ["packages/core/src/attribute/stack.test.ts"] },
 { "test": "packages/core/src/attribute/call-site.test.ts", "bearing": "unmeasured",
   "because": "no import graph was supplied" }
]
groups: [{"hops":0,"n":2,"unplaced":false},{"n":1,"unplaced":true}]
```

Read that output as follows, because every part of it is a rule you will meet
again.

- `whole` is what the snapshot may speak for; `entered` is what the diff
  reached. **Skip is `whole` minus `entered`, and never a run list** — a skip
  list only has to be right about the paths it names.
- `unread` names a changed path the record says nothing about and the graph
  does not list. It selects nothing, and the skip list is still `whole` minus
  `entered`. Print it: if the suite reads that file without importing it, it is
  a precondition to declare.
- `because` gives one entry per selected test, in the order of `entered`: a
  `region` (file, name, path and lines of the innermost recorded block a changed
  line fell in), a `precondition` by name, or an `importer` with the trail.
- Two tests came back at `hops: 0` and one `unmeasured` — **because no import
  graph was passed.** Distance cannot be measured without one. To measure it,
  pass `relations` from `scanRelations` plus `faces: indexFaces(relations)`.
  Without them every non-precondition test is `unmeasured`, and therefore
  unplaced.

`selectTestFiles(file, diff, options)` returns `entered` alone, for a caller
that has established `whole` some other way. `narrowByExecution` is the same
query without the distances. Use `narrowByExecution` or `distanceByExecution`
whenever the answer will *exclude* anything.

Full field reference, including `stale` and the `sourceAt` check: the README of
the installed package — `node_modules/@variance-authority/sense/README.md` in a
consumer repo, `packages/sense/README.md` in this one.

## Run the near end first

Every test in the distance reading carries the number of imports from the
change, counted only through modules that test actually entered. The nearest
tests exercise the changed file with the fewest modules in between, so a failure
arrives sooner and has fewer possible causes.

The Sense package defines no command-line spelling. It defines three functions,
and they are how you take one leg:

```js
import { atDistance, distanceRange, remaining } from '@variance-authority/sense/test-selection';

// `distances` is what `distanceByExecution` returned above.
const range = distanceRange('0-2');       // undefined for anything unparsable
const running = atDistance(distances, range.from, range.to);
const later = remaining(distances, range.from, range.to);
```

`distanceRange` reads exactly `2`, `0-2` and `3-`, and returns `undefined` for
anything else — report the typo rather than quietly running one distance.
`groupByDistance(distances)` is the whole reading, one group per hop count that
occurs, `unplaced` last.

When a repository-owned entry point exposes distance ranges, treat them as hop
counts and use the syntax that entry point documents. In *this* repository that
is `yarn test:since --at-distance 0-2`, whose own `--help` says:

```text
  --at-distance <range> run only the tests this many imports from the change.
                        `0-2`, `2`, or `3-`. Zero is a test whose own source
                        you edited. Tests with no measurable distance ride
                        with the leg that reaches the end.
```

A changed path no chain of imports connects to a measured module selects
nothing there; one the graph does not list is named. The whole suite runs only
when the reading itself could not be made:

```text
test:since: running the whole suite — the install could not be compared against 03984ae78218.
  429 files
```

- `0-2` means *no more than two imports away*. It is not *the first two groups*.
  A change whose nearest test is five hops out answers `0-2` with nothing, and
  that is the true answer — run `3-` next.
- Start at `0`. Zero is a test whose own source the edit touched, and it is the
  most direct evidence there is. A range starting at `1` leaves it until last.
- In the `0-2` then `2-4` loop the help prints, the overlap at two hops is
  deliberate: it reconnects the wider run to the boundary the edit loop already
  exercised. `0-2` then `3-` is the partition instead — pick one and say which.
- A test in the reading whose distance could not be measured is **unplaced**: it
  is a member of `distances` with no `hops`. `atDistance` gives the unplaced to
  the leg that reaches the end and to no other, so over the array you passed,
  `0-2` then `3-` runs every element exactly once.
- A current test file that is **not an element of `distances` at all** is a
  different case, and `atDistance` cannot return it: it was never passed in. The
  two sentences are not in conflict — the first is about the array's contents,
  the second about what the array omits. Your integration owns the test
  inventory; diff it against `distances`, keep the difference selected, and run
  it in the final leg.

An integration should show the whole reading beside the leg it took and name
the files left behind. A green `0-2` says the nearest tests passed and says
nothing at all about four hops; reporting it as a passing suite reports a pass
over work nothing ran.

## Distance does not predict runtime

A nearby test can be slow, and splitting one run into two can cost more wall
clock than running it once. The benefit is earlier and more focused feedback,
not a faster suite. Do not present a distance as a time estimate.

## Two findings that need no failing test

Every `TestDistance` carries a `bearing`, one of six strings. Four carry a
`hops` count — `precondition` (zero, the test's own source changed), `direct`
(one), `transitive` (more), and `reach-through`. Two carry none:
`unexplained` and `unmeasured`.

Two of the six are findings. Both are reported whether or not anything failed,
and both have an address. Neither is proof of a defect's cause.

- **`reach-through`** — a hop on the path landed inside a directory rather than
  on the entry module that directory publishes itself as. The report names the
  importer, the internal file, and the intended entry. Start at the importing
  line, not at the failure.
- **`unexplained`** — the test entered the changed module along no chain of
  imports it executed, while the graph accounts for the rest of that run. Shared
  state, a registry, a singleton, a patched prototype, a module-level assignment
  two files agree about and nothing declares. The label does not say which.

## Absent is not zero, and unmeasured is not a finding

- **`unmeasured`** means the graph could not answer — a built artifact the scan
  does not read, a directory it was not pointed at, a file whose imports nothing
  could enumerate, or no graph at all. It carries the reason in a `because`
  string — `"no import graph was supplied"` is the one you will see first.
  Treat it as missing information about the project's wiring, not as a finding
  about its code.
- A distance that could not be measured is **absent**. It is never zero: zero
  means the test's own source changed, which is the nearest thing there is.
  A report that renders a missing distance as `0` is wrong, and sorts the least
  understood work in the run to the front.
- A test whose distance is unknown is still **selected**. Unplaced is a fact
  about the graph, not permission to skip the test.

## Configure what the run rests on

Some files decide how every test runs and are imported by nothing: the harness
config, the setup it loads, the bundler setup, the node version, the CI
workflow. No walk reaches them, so a diff that touches one beside an ordinary
source file narrows as if it had not. Naming them is a one-time inventory, and
it is a job for you rather than for a rule — which paths govern a run is a fact
about the repository, and every heuristic that guessed was both too wide and
too narrow on the same diff.

Take it in this order, and read rather than assume:

1. **The harness.** Whatever actually starts the suite: `vitest.config.*`,
   `jest.config.*`, `playwright.config.*`, and any file they extend. Confirm
   from `package.json`'s `scripts` which one runs, and follow a `--config` flag
   if there is one.
2. **What the harness names but does not import** — `setupFiles`,
   `globalSetup`, `setupFilesAfterEnv`, `testEnvironment`, `moduleNameMapper`
   targets. A config that `import`s its setup already carries it; one that
   names it as a string does not, so that path is its own entry.
3. **The build the tests run through.** `vite.config.*`, `next.config.*`,
   `webpack.config.*`, `babel.config.*`, `postcss.config.*`, `tailwind.config.*`
   — whichever the suite actually goes through. A formatter or linter config
   does not belong here; nothing it says changes a render.
4. **The environment.** `.nvmrc`, the `engines` block's file if there is one,
   the CI workflow directory, a `Dockerfile` the suite runs inside.
5. **Nothing else.** A README, a changelog, an editor setting and a fixture
   JSON are not entry points. Adding them buys whole runs and no information.

Write them into the config as repository-root-relative paths. A directory
claims everything under it:

```json
{
  "source": {
    "dirs": ["src"],
    "relations": true,
    "before": ["vitest.config.ts", "vitest.setup.ts", ".github/workflows", ".nvmrc"]
  }
}
```

`source.before` needs `source.relations: true`: what a declared entry point
buys beyond its own name is everything below it, and that is a walk down the
file graph.

Then check the answer rather than trusting the list. Run a selection over a
diff that touches one of the named files and one ordinary component, and
confirm the run comes back whole. A note naming entries the scan does not hold
is normal for a `.nvmrc` or a workflow — they have nothing under them to read.
It is not normal for the harness config: it means the setup files below it are
still narrowing to nothing, and the usual cause is a path that does not exist
or an extension the scan has no reader for.

## What selection refuses to narrow

Selection over-includes on purpose, because skipping a test that should have run
produces a green report over unwatched work, and silently. Expect these and do
not argue with them:

- A test file that changed selects itself.
- A run that cannot list its changed files at all does not narrow.
- A lockfile that cannot be read, or cannot be read at the base revision, does
  not narrow. A comparison that failed is not a comparison that found nothing.
- A change to the harness, the bundler config or the node version does not
  narrow. Nothing imports them, so there is no edge to walk and no answer
  smaller than the whole suite. It is only *noticed* when something declares
  it: `source.before` for `variance run --since`, and a precondition for the
  test integrations. The Vitest integration declares the config file Vite
  loaded and the local modules it imports; Jest and Rstest take the config in
  `preconditions`. Undeclared, a config edited beside a component file is
  invisible.
- A file below a declared entry point — a setup module, a fixture only that
  setup imports — does not narrow either, and neither does a package the
  harness rests on. A `jsdom` bump reaching a jest environment reaching a
  config is one trail, and no file in the repository spells the word.

When an integration reports that it retained the whole suite, read the named
path. That is a wiring fact about the project, and usually a fixable one.

Absence is the other direction, and it widens nothing. A changed path the
snapshot has no row for is asked of the import graph when you pass
`relations`, and the nearest measured files that import it select their tests.
One the graph does not list — a README, a fixture — appears under `unread` and
selects nothing; one it lists whose importers reach nothing measured selects
nothing and is not reported. A bumped package selects the tests of its measured
importers; one with none selects nothing and is not reported.

## A recorded run costs memory, not time

Recording changes the suite's wall clock very little, but every module a test
loads runs with probes in it, so each worker needs more memory. On a machine
that is already near its memory limit with the plain suite, the recorded suite
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
   grows to the limit whether or not the suite is recorded; the probes make
   each file larger, which gets it there sooner. One `beforeAll` per file is
   enough, and the setup file the wrap adds has two. The flag selects Node's
   older implementation, which releases that memory as usual. Jest 29 does not
   grow this way.
3. Lower the worker count (`--maxWorkers` in Jest and Vitest). A recording run
   with fewer workers still pays for itself: the snapshot it writes shortens
   every later run.
4. Under Jest, set `workerIdleMemoryLimit` in the configuration, so a worker is
   restarted once it grows past that size. That caps the growth without
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

## Do not

- Do not report a narrowed run, or a near range, as a passing suite.
- Do not read a timeout under a recorded run as a slow test before you have
  compared memory with and without the wrap.
- Do not re-record the snapshot to make a selection smaller. A stale snapshot
  widens the run; it does not hide tests.
- Do not infer a distance from reading imports yourself. The graph says what
  could be imported; only the record says what ran, and a distance has to be
  true of both.
