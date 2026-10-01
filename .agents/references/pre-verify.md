# Pre-verify

Phase 4 of [`AGENTS.md`](../../AGENTS.md). Run what the change reached, near end
first, then the gate — in a checkout you have reconciled, so a failure means the
change.

## Look around

**What have I done?** Read `git diff origin/main` as the reviewer will, before
the runs below. The failing test the change began with has already run; these
have not. Each new function, file or command is asked the question
[refine](refine.md) asked of the task: what already did this? A new walk beside
an existing one, a helper that repeats a package's export, a fix to a symptom
whose owner sits upstream — each is thrown away here, while it costs only the
time already spent. Green tests do not answer this; a duplicate passes its own.

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
yarn install && yarn build && yarn verify
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

## The loop

```bash
yarn test:since --at-distance 0-2   # while the edit is still open
yarn test:since --at-distance 2-4   # before handing the change over
yarn build && yarn verify           # the gate, and the only green that counts
```

`verify` is `yarn lint && yarn check && yarn measure && yarn test`, in that
order. `check` is the `tools/*.check.ts` suite, which includes the documentation
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
yarn test:since                    # since the commit each test last ran at
yarn test:since main               # since the merge base with main
yarn test:since --dry-run          # decide, explain, run nothing
yarn test:since --at-distance 0-2  # only the tests within two imports of the change
yarn test:since --help             # every flag
```

Each test is read from the commit it last ran at. A leg stamps the snapshot
with `HEAD`, and the tests it did not run are still read from where they last
ran, so the next leg selects them. Once every test has run at the snapshot's
commit, the reading starts there. A ref reads every test from no later than the
merge base with it. A file this machine skips whole, such as a browser-gated one
with no browser installed, never records whole here, so it is selected every
time.

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
suite collects — and it says which:

```
test:since: running the whole suite — the install could not be compared against 03984ae78218.
  429 files
```

So a green `test:since` is a smaller claim than a green `verify`: use it in the
loop, and report against the gate.

**Distance.** Every selected test carries its distance from the change — the
number of imports between them, counted through the modules that test actually
entered. The near ones fail first and for the simplest reason. `0-2` is *no more
than two imports away*, not *the first two groups*: a change whose nearest test
is five hops out answers it with nothing, which is the true answer. Start at
`0` — a test whose own source you just edited. The overlap at two hops is
deliberate: it reconnects the wider run to the boundary the edit loop already
exercised.

The loop is not a partition. `2-4` leaves anything five hops or further out, and
every test the reading could not place, to `yarn verify`. For a partition, run
`0-2` then `3-`: a leg open at the top carries the tests with no measurable
distance, so the two legs run every selected file exactly once. Every run prints
how many selected files its leg left behind, and the range that runs them.

`--at-distance` narrows a reading; it cannot narrow a widening. When the reading
could not be made, the run is the whole suite and the flag is never consulted,
so no leg is shorter than `yarn test` until the install compares or the
recording has a whole observation.

Two findings arrive whether or not anything failed: an import that reached past
a directory's own entry point, and a test the change entered by no route it
imported. [`docs/distance.md`](../../docs/distance.md) is the reference.

**The recording is not in git.** It sits in [the cache](../../docs/cache.md),
under `<cache>/test-selection/`, in a directory keyed by a digest of this
checkout's absolute path — a worktree's own under `.work/`, layered over the
primary checkout's, which it reads and never writes. Every `yarn test` folds its
run into it, and that is the whole of the invalidation. Nothing expires and
nothing is checked for age, so an answer the snapshot gets wrong stays wrong
until a run replaces it. To force a cold recording, delete that directory and
run `yarn test`.
