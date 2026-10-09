# Pre-verify

Phase 4 of [`AGENTS.md`](../../AGENTS.md). Run what the change reached in
waves, near end first, and leave the gate to CI — in a checkout you have
reconciled, so a failure means the change.

## Look around

**What have I done?** Read `git diff origin/main` as the reviewer will, before
the runs below. The failing test the change began with has already run; these
have not. Each new function, file or command is asked the question
[refine](refine.md) asked of the task: what already did this? A new walk beside
an existing one, a helper that repeats a package's export, a fix to a symptom
whose owner sits upstream — each is thrown away here, while it costs only the
time already spent. Green tests do not answer this; a duplicate passes its own.

A new flow next to an existing one is compared step by step, on one screen,
before it is kept. `collect` was built beside `run`'s acquisition loop, given
error handling and a merge of its own, and defended through three review
warnings. The features made the copy look different, and one of them fixed a
bug in the copy only. When the steps match, the change is two commits: the
shared path pulled out of the existing caller with no change in behaviour,
which its own tests check, then the new caller on top. The repository checks
find pasted blocks and the three re-typed idioms. They do not find a re-typed
flow.

**Is the checkout reconciled?** An out-of-date checkout reports defects, not
errors, and that is what makes it expensive. Nothing here imports another
package by relative path, so a check asking the CLI what a setting means
resolves through the manifest's `exports` into `dist/` — the same path a
consumer takes. A *missing* build announces itself. A **stale** one answers every
question fluently and some of them wrong, and the answer arrives dressed as a
defect in whatever was asked about: `packages/cli/README.md` documenting a
setting the parser rejects, run against a `dist/` built before that setting
existed. A stale `node_modules` does the same one layer down — *Invalid hook call
… more than one copy of React* reads as a defect in the runtime layering and is
not one. Both are worst in a fresh worktree, which starts with neither:

```bash
yarn install && yarn build
```

**Is every new file tracked?** The checks read the index with `git ls-files`. A
file that is not tracked is a file they cannot see: a new module over 500 lines
passes the line-count check until it is added, and fails on the first run
after.

**Does a worktree resolve into itself?** A `node_modules/node_modules` link
pointing at another checkout sits on Node's resolution walk for every nested
package, and loads that checkout's `react` or `playwright` instead of yours. A
failure whose stack trace runs through the other checkout's path is this, not
the change. `ls -la node_modules/node_modules` shows it; nothing in the
repository creates it, so delete it.

**Is the machine quiet?** Check `uptime` before believing a failure: a load
average above the core count means the run is contended. A browser
suite under contention fails in teardown, and the failure moves between runs —
the exact signature this project exists to tell apart from a real one.

## The waves

Verification runs in waves, nearest and cheapest first, and each wave starts
only when the one before it is green:

```bash
yarn verify:near    # 1. lint, tsc --build, the selection within two imports
yarn verify:rules   # 2. yarn check, once near is green
yarn verify:far     # 3. the rest of the selection, once, before the PR
```

The order is the order failures arrive in. Lint and an incremental
`tsc --build` take about a second each, and a test within two imports of the
edit fails first and for the simplest reason, so the near wave answers in
seconds and is the only wave the edit loop repeats. It type-checks with
`tsc --build`, not `yarn typecheck`, whose `--force` rebuilds every project.
The repository checks are minutes and cannot be selected, so they run once the
change has stopped moving. The far wave is the
rest of the selection — `0-2` and `3-` partition it, so together they run every
selected file once, and a test file the recording never saw in both — and it
runs once, as the last thing before the pull request.

**A red wave sends you back to the edit, then to wave 1**, not to the wave that
failed: the fix is a new edit, and its nearest tests are wave 1's. **A green
wave is not run again** on code that has not changed since. A run repeated to
be sure is the time this loop exists to save.

**A failure is reproduced on its own file**, `yarn vitest run --config <slice
config> <file>`, never by re-running the wave. One file re-run under a quiet
machine says whether it was the change; a wave re-run says it again slower.

**A slice the reading runs whole is not a wave.** Read `yarn variance select
--suite <slice>` first: when it skips nothing, or the runner prints
`declined:`, the near wave is the whole slice and the distance is never
consulted. Run the test files you edited by
path, wave 2, and push — CI runs the whole suite on its own runners.

**The gate is CI's.** `verify` is `yarn lint && yarn check && yarn measure &&
yarn test`, and the check workflow runs every part of it on the pull request:
`rules` runs lint and wave 2, the build type-checks, `suite` runs the test legs
of waves 1 and 3, `measure` times the product on a
quiet machine. Running `yarn verify` locally repeats that at laptop speed. Run
it, or `yarn measure`, only to reproduce a check that failed there.

`check` is the `tools/*.check.ts` suite, which includes the documentation
checks: every link resolves, every path named in prose exists, every `file:line`
lands where it says, stated counts are the counts, and the CLI command lists
match the binary's own table. `measure` runs the `*.measure.ts` files that gate
on what the product costs — separate from the suite because the suite
instruments what it loads, and a ratio cannot be timed through the thing timing
it.

Write a run's output to a file outside the repository and read the file. Never pipe `yarn test` into
`head`: closing the pipe early leaves browsers running, and the next run fails
for reasons that have nothing to do with the change.

```bash
yarn test > "$TMPDIR/test.log" 2>&1
```

The cost of a false red is never the red line. It is the change somebody makes
to satisfy it — correct documentation deleted, working code rewritten. Reconcile
the checkout before believing a failure, and re-run before reporting one.

## How `test:since` selects

`yarn test` records which test file executed which region of which module.
`yarn test:since` reads that back and runs the files a change reached. It needs a
recording: a worktree that has not run reads the primary checkout's, and a
checkout where `yarn test` has never run has nothing to read.

```bash
yarn test:since                                    # every slice, since the commit each test last ran at
VARIANCE_AUTHORITY_SINCE= yarn test:unit           # one slice
VARIANCE_AUTHORITY_AT_DISTANCE=0-2 yarn test:since # only the tests within two imports of the change
yarn variance select --suite unit                  # decide, explain, run nothing
```

`test:since` takes no arguments of its own: it is three `vitest run` calls,
and anything written after it reaches only the last one, the chromium slice. To
hand Vitest a flag, run one slice with the variable set:
`VARIANCE_AUTHORITY_SINCE= yarn test:unit --shard=1/4`.

`test:since` is `yarn test` with `VARIANCE_AUTHORITY_SINCE` set. The seam
each slice's config is wrapped in reads the selection, the runner drops the
files it skips before it starts any, and one line says what happened:
`selected 12 of 676`, `selected none of 676`, or `declined: <why>`. The `read`
lines, one per changed file, are `variance select`'s; the run prints only its
count and notes. Set to a ref, the variable also names the base for a recording
that names no commit of its own.

Each test is read from the commit it last ran at. A leg stamps the snapshot
with `HEAD`, and the tests it did not run are still read from where they last
ran, so the next leg selects them. Once every test has run at the snapshot's
commit, the reading starts there. A file this machine skips whole, such as a
browser-gated one with no browser installed, never records whole here, so it
is selected every time. A test file the recording never saw runs.

It selects on what the recording measured, and on nothing else. Each changed
file is read from both of its texts first, and prints a `read` line saying what
the edit does. A module added since the recording is read the same way, with
every export counted as changed, so it selects the tests that entered a function
reading one. A changed file the recording has no row for, and that reading
cannot answer — a stylesheet, a page-side module that cannot take a probe — is
asked of the import graph, and the nearest measured files that import it select their
tests; a bumped package is answered the same way by its measured importers. A
changed path the graph does not list either — a README, a fixture — selects
nothing by itself and is reported.

What the harness loads without importing it is declared instead: the seam
declares `vitest.config.mts` and the local modules it imports, such as
`tools/page-side.mjs`, and the config names the rest in `preconditions`
(`tsconfig.base.json`). A change to any of them selects every test. A change
confined to manifests is read as the install it records, and runs nothing when
no installed package moved. A fixture a test reads with `fs` is named in
`preconditions` the same way, or a change to it selects nothing.

The whole suite runs only when the reading itself could not be made — an install
it could not compare, or a snapshot with no whole observation of any file the
suite collects — and the runner says which, after `declined:`.

So a green `test:since` is a smaller claim than a green `verify`: use it in the
waves, and report against CI's gate.

**Distance.** Every selected test carries its distance from the change — the
number of imports between them, counted through the modules that test actually
entered. The near ones fail first and for the simplest reason. `0-2` is *no more
than two imports away*, not *the first two groups*: a change whose nearest test
is five hops out answers it with nothing, which is the true answer. Start at
`0` — a test whose own source you just edited.

The near and far waves are a partition: `0-2` then `3-`. The tests with no
measurable distance run in the leg that holds the furthest measured hop, or in
the leg open at the top when nothing was measured, so the two legs run every
selected file once. The far wave reads the record the near wave just saved, and
runs any test nearer than three hops that the near wave did not. `variance select --at-distance` prints how many selected
files a leg leaves behind, and the range that runs them.

A distance narrows a reading; it cannot narrow a widening. When the reading
could not be made, the run is the whole suite and the distance is never consulted,
so no leg is shorter than `yarn test` until the install compares or the
recording has a whole observation.

[`docs/distance.md`](../../docs/distance.md) is the reference.

**The recording is not in git.** It sits in [the cache](../../docs/cache.md),
under `<cache>/test-selection/`, in a directory keyed by a digest of this
checkout's absolute path — a worktree's own under `.work/`, layered over the
primary checkout's, which it reads and never writes. Every `yarn test` folds its
run into it, and that is the whole of the invalidation. Nothing expires and
nothing is checked for age, so an answer the snapshot gets wrong stays wrong
until a run replaces it. To force a cold recording, delete that directory and
run `yarn test`.
