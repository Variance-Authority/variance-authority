---
name: variance-test-selection
description: Use when choosing which tests to run after a source edit, which of them to run first, or when reading a distance, band, reach-through or unplaced finding from a test-selection snapshot.
---

# Test selection and distance

When a repository has configured the Vitest or Jest integration, a suite run
records which test file entered which region of which module. Test selection
reads that record back and answers two questions about an edit: **which recorded
tests it reached**, and **how far it travelled to each one**. Both are answers
about what executed, not predictions from a build graph.

Use this to shorten the loop. It does not replace the gate: the full suite is
the only green that counts, and every narrowing here is a smaller claim than it.

## Establish whether the project has an execution entry point

A repository may wire the API into its own script. Read `package.json` and the
repository instructions first. Do not assume a command name or runner option:
`test:since` and `--at-distance` belong to the Variance Authority repository's
contributor tooling and are not installed by `@variance-authority/sense`.

Use a repository-owned command only when that repository defines and documents
it. Its orchestration must own the current test inventory and dispatch each path
to the Vitest, Jest, Playwright or other host that can execute it.

If there is no script, the contract is
`@variance-authority/sense/test-selection`, and `packages/sense/README.md` is
the integration reference. That is not an invitation to add orchestration during
an unrelated task: implementing inventory, conservative selection and runner
dispatch is product work. Do not hand-roll a selection from `git diff` and a
grep for imports; the answer depends on the execution record, which only the
snapshot holds.

## Run the near end first

Every test in the distance reading carries the number of imports from the
change, counted only through modules that test actually entered. The nearest
tests exercise the changed file with the fewest modules in between, so a failure
arrives sooner and has fewer possible causes.

When the repository-owned entry point exposes distance ranges, treat them as hop
counts. Use the option syntax that entry point documents; the Sense package does
not define a command-line spelling.

- `0-2` means *no more than two imports away*. It is not *the first two groups*.
  A change whose nearest test is five hops out answers `0-2` with nothing, and
  that is the true answer — run `3-` next.
- Start at `0`. Zero is a test whose own source the edit touched, and it is the
  most direct evidence there is. A range starting at `1` leaves it until last.
- The overlap at two hops between the two legs is deliberate. It reconnects the
  wider run to the boundary the edit loop already exercised.
- Tests with no measurable distance run with the leg that reaches the end, so
  `0-2` then `3-` runs every file represented in the reading exactly once.
- Current test files absent from the distance reading are not in either range.
  The repository integration must keep them selected and carry them in its
  final leg.

An integration should show the whole reading beside the leg it took and name
the files left behind. A green `0-2` says the nearest tests passed and says
nothing at all about four hops; reporting it as a passing suite reports a pass
over work nothing ran.

## Distance does not predict runtime

A nearby test can be slow, and splitting one run into two can cost more wall
clock than running it once. The benefit is earlier and more focused feedback,
not a faster suite. Do not present a distance as a time estimate.

## Two findings that need no failing test

Both are reported whether or not anything failed, and both have an address.
Neither is proof of a defect's cause.

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
  could enumerate. It carries a reason. Treat it as missing information about
  the project's wiring, not as a finding about its code.
- A distance that could not be measured is **absent**. It is never zero: zero
  means the test's own source changed, which is the nearest thing there is.
  A report that renders a missing distance as `0` is wrong, and sorts the least
  understood work in the run to the front.
- A test whose distance is unknown is still **selected**. Unplaced is a fact
  about the graph, not permission to skip the test.

## What selection refuses to narrow

Selection over-includes on purpose, because skipping a test that should have run
produces a green report over unwatched work, and silently. Expect these and do
not argue with them:

- A changed path the snapshot holds no row for — a file added since the
  recording, a fixture, a module that cannot carry a probe — appears under
  `unread`; the caller clears its skip list and names the path.
- A test file that changed selects itself.
- A run that cannot list its changed files at all does not narrow.

When an integration reports that it retained the whole suite, read the named
path. That is a wiring fact about the project, and usually a fixable one.

## Do not

- Do not report a narrowed run, or a near range, as a passing suite.
- Do not re-record the snapshot to make a selection smaller. A stale snapshot
  widens the run; it does not hide tests.
- Do not infer a distance from reading imports yourself. The graph says what
  could be imported; only the record says what ran, and a distance has to be
  true of both.
