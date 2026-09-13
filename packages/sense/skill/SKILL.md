---
name: variance-test-selection
description: Use when choosing which tests to run after a source edit, which of them to run first, or when reading a distance, band, reach-through or unplaced finding from a test-selection snapshot.
---

# Test selection and distance

`yarn test` — or whichever command runs the suite — records which test file
entered which region of which module. Test selection reads that record back and
answers two questions about an edit: **which tests it reached**, and **how far
it travelled to each one**. Both are answers about what executed, not
predictions from a build graph.

Use this to shorten the loop. It does not replace the gate: the full suite is
the only green that counts, and every narrowing here is a smaller claim than it.

## Find the project's entry point before writing any code

A repository that ships selection usually wires it into a script. Read
`package.json` first and look for one — in this repository it is `test:since`:

```
yarn test:since --help
```

If there is no script, the contract is
`@variance-authority/sense/test-selection`, and `packages/sense/README.md` is
the integration guide. Do not hand-roll a selection from `git diff` and a grep
for imports; the answer depends on the execution record, which only the snapshot
holds.

## Run the near end first

Every selected test carries its distance from the change: the number of imports
between them, counted only through the modules that test actually entered. The
nearest tests exercise the changed file with the fewest modules in between, so
a failure arrives sooner and has fewer possible causes.

Ranges are hop counts:

```
yarn test:since --at-distance 0-2   # while the edit is still open
yarn test:since --at-distance 2-4   # before handing the change over
yarn test                           # the gate
```

- `0-2` means *no more than two imports away*. It is not *the first two groups*.
  A change whose nearest test is five hops out answers `0-2` with nothing, and
  that is the true answer — run `3-` next.
- Start at `0`. Zero is a test whose own source the edit touched, and it is the
  most direct evidence there is. A range starting at `1` leaves it until last.
- The overlap at two hops between the two legs is deliberate. It reconnects the
  wider run to the boundary the edit loop already exercised.
- Tests with no measurable distance run with the leg that reaches the end, so
  `0-2` then `3-` runs every selected file exactly once.

Every run prints the whole reading before the leg taken out of it, and names the
files that leg left behind. Report those names when handing over. A green `0-2`
says the nearest tests passed and says nothing at all about four hops; reporting
it as a passing suite reports a pass over work nothing ran.

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
  recording, a fixture, a module that cannot carry a probe — runs everything,
  and the report names the path that caused it.
- A test file that changed selects itself.
- A run that cannot list its changed files at all does not narrow.

When a run reports that it ran everything, read the named path. That is a wiring
fact about the project, and usually a fixable one.

## Do not

- Do not report a narrowed run, or a near range, as a passing suite.
- Do not re-record the snapshot to make a selection smaller. A stale snapshot
  widens the run; it does not hide tests.
- Do not infer a distance from reading imports yourself. The graph says what
  could be imported; only the record says what ran, and a distance has to be
  true of both.
