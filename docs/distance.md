# Measure test distance

After a source change, [test selection](selecting.md) narrows your suite to the
test files that change could have reached. On a shared module that narrowed set
is still most of the suite, and nothing in it tells you which file to run first.
Distance orders it: for each selected test file it counts the import steps —
**hops** — between the changed source and that test, so you can run the closest
files first and read an answer while the edit is still fresh.

What you have for this today is an import graph. A graph on its own can offer a
short path through a module the test never loaded. Distance walks only the
modules that test covered or loaded in a recorded run, so the count it gives you
describes execution rather than possibility.

A wrapped Vitest or Jest run takes one range of distances at a time when you
set `VARIANCE_AUTHORITY_AT_DISTANCE` beside `VARIANCE_AUTHORITY_SINCE`, and
`variance select --at-distance` prints the same leg's skip list:

```bash
VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=0-2 npx vitest run
VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=3- npx vitest run
```

The runner's own inventory is the other half of that join, so every selected
file runs in one of the two legs. A test new since the recording runs in
both. A test recorded incomplete runs in the leg of the shortest import path it
ran to a changed file it loaded, or in the second when it ran none.
[Run the tests an edit needs](test-an-edit.md) is the page about that loop. The
rest of this page is for a repository that composes the legs itself, across
several test hosts, from the API in `@variance-authority/sense/test-selection`.

To turn distance into a run yourself, you supply four things:

1. the current test-file inventory for every host you own;
2. a unified diff and the import relations needed to place paths;
3. the conservative join between that inventory and the snapshot's skip list;
4. dispatch from each selected path to the runner and project that owns it.

The inventory matters because a snapshot is historical. It can justify skipping
a test it observed completely; it cannot enumerate a new test, detect that a
recorded test no longer belongs to your suite, or decide which runner should
execute a file. A wrapped runner takes it from what that runner discovered; for
any other host, you can take it from a retained host index, incremental
discovery, or the runner itself.

## Partition the distances Sense can measure

`distanceByExecution` reads a snapshot once and returns both the execution
narrowing and the distances it can place:

```ts
import {
  distanceByExecution,
  indexFaces,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';

// `diff` is a unified diff and `relations` is the caller's import graph.
const { narrowing, distances } = await distanceByExecution(
  testCoverageFile(process.cwd()),
  diff,
  { relations, faces: indexFaces(relations) },
);
```

This is a partial integration: it reads recorded evidence but neither inventories
the current suite nor invokes a runner. `narrowing.whole` names test files whose
recording completed, `narrowing.entered` names the recorded files the diff
reached, and `narrowing.unread` names changed paths the snapshot has no rows
for and the graph does not list. `distances` can hold a test outside
`narrowing.entered`: one recorded incomplete that the diff did not enter,
placed by the shortest path it ran to a changed file it loaded.

A safe execution integration starts from its **current host inventory** and
subtracts only exclusions the snapshot proved:

```text
skip = whole minus entered
selected = current host inventory minus skip
```

Everything outside `whole` remains selected: new tests, partially recorded
tests, files another host owns, and files absent from the snapshot. `unread` is
a report, not an input to the join: it lists a README, a fixture a test reads
with `fs`, a script a test spawns. When your suite depends on one of those, name
it in the integration's `preconditions` option; it then selects every test that
declared it and leaves `unread`. That option names files. The state a test ran
under, such as what a mock returns, is recorded as a [case
precondition](case-preconditions.md): nothing in a checkout changes it, so it
never selects a test.

After that join, distance can divide the measured part of `selected` into
ranges:

```ts
import {
  atDistance,
  distanceRange,
  remaining,
} from '@variance-authority/sense/test-selection';

const { from, to } = distanceRange('0-2') ?? {
  from: 0,
  to: Number.MAX_SAFE_INTEGER,
};
const nearbyMeasured = atDistance(distances, from, to);
const laterMeasured = remaining(distances, from, to);
```

These arrays contain only tests represented in `distances`. A selected test with
no distance must remain in the host integration's workload and run in its final
leg. Passing `nearbyMeasured` directly to a runner as though it were the whole
selection can silently omit new or incompletely recorded tests.

For several kinds of tests, keep host ownership beside the inventory and dispatch
after selection:

```text
current inventories
├── unit / Vitest
├── integration / Jest
└── another repository-owned host
        ↓ subtract only proven skips
selected paths, still carrying their host
        ↓ order paths that have a measured distance
each host invokes its own runner
```

[Sense](../packages/sense) returns paths and evidence. It does not provide this registry or dispatcher.
Apply each snapshot only to the host inventory whose execution it recorded; one
runner's absence is not evidence about another runner's suite.

## Read a distance range

The range is measured in import hops, not positions in a list:

- `0-2` means every measured, selected test no more than two imports from the
  change.
- `2` means exactly two hops.
- `3-` means three hops and beyond.

Start at zero. Zero means the test's own source or a recorded precondition
changed. One means the test imports the changed module directly. Larger values
count the shortest import path through modules that test actually covered or
loaded.

If the nearest measured test is five hops away, `0-2` is empty. Distance does
not renumber the groups to fill a requested range.

A test selected from the snapshot without a measurable path is **unplaced**.
`atDistance` returns such tests with the range that covers the measured end.
Tests selected only by the current host inventory are outside the distance
reading altogether and stay your integration's responsibility.

Every range is a smaller claim than the selection, which is already a smaller
claim than the suite. Passing a near range shows nothing about selected tests in
later ranges or about tests the snapshot could not place.

### What a near range buys you

Not a shorter suite. A nearby test can be slow, and running `0-2` and then `3-`
can cost more wall clock than running the selection once. What arrives earlier
is the first answer, from the tests with the fewest modules between the change
and the assertion, so you see a failure sooner and it has fewer candidate
causes.

A distance is not a time estimate. Take a near range when you want feedback
during the edit, and run the whole selection before you treat the change as
verified.

## Connections worth investigating

**`reach-through` points to an import that bypasses an interface.** The reading
names the importer, the internal file it imports, and the intended entry point:

```text
src/report/report.tsx imports src/button/abstract-button.tsx;
src/button's entry point is src/button/index.ts
```

Start with the importing line when investigating this finding.

A *unit* here is a directory intended to be accessed through one entry file.
`indexFaces` uses directories with an `index` module to identify those entry
points. If a project defines boundaries differently, supply another provider.
`eitherFace` tries that provider before falling back to `indexFaces`.

**`unexplained` means there is a recorded connection without a matching import
path.** Shared state, a registry, or a patched prototype are possible causes.
The label does not identify which one is responsible. It appears only when the
graph accounts for the rest of that run; otherwise the result is `unmeasured`.

Both findings are reported even when tests pass. They identify places to
investigate, not proof of a failure or its cause.

**`unmeasured` means information is missing.** The graph might omit a built
artifact, an unscanned directory, or a file's imports. Its reason names the gap
that prevented measurement.

A missing distance stays absent. It is never reported as zero, because zero
means the test's own source or a precondition changed.

## How distance is measured

Distance combines the import graph with the record of what each test ran. It
finds the shortest path between the changed file and the test using only modules
that test covered or loaded. If several changed files select the same test, the
nearest determines its distance. A test selected because it reads a value the
change altered is measured from the file that declares the value.

An import graph alone can suggest a shorter path through a module the test never
loaded. The [execution record](execution-record.md) rules out that path.

The distance options describe how to interpret the caller's graph:

- `knownAs` connects different names for the same module, such as a source file
  in the execution record and its built output in the import graph.
- `faces` identifies public entry points, so the report can flag imports that
  bypass them.
- `enumerated` records whether a file's imports were scanned. Without it, the
  traversal assumes every file in the graph was fully scanned.

## What the labels mean

Each measured test has a **bearing** describing its connection to the change.

| Bearing | Meaning |
|---|---|
| `precondition` | The test's own source or a recorded precondition changed. Zero hops. |
| `direct` | The test imports the changed module directly, without bypassing a public entry point. One hop. |
| `transitive` | The path passes through other modules without bypassing a public entry point. More than one hop. |
| `reach-through` | An import on the path bypasses a unit's public entry point and accesses an internal file. |
| `unexplained` | The graph accounts for the rest of the test's run but has no import path connecting it to the change. |
| `unmeasured` | The graph lacks enough information to determine the distance. The report includes a reason. |

The first four labels include a hop count. `unexplained` and `unmeasured` do not.
A longer path is not itself a problem.

## Limits

**A leg covers one runner's suite.** A wrapped runner joins the leg with the
files it discovered. Across several hosts, the inventory and the dispatch are
yours, as above.

**Distance describes recorded execution.** It cannot provide a path for a
branch that no recorded test took. When a change cannot be read from both of
its texts, selection charges a changed line no recorded region contains to every
test that ran its module; distance counts only the imports those tests actually
took, and counts nothing for a path none of them took.

**Distance is not detection distance.** It counts import hops to a selected
test. It does not show that test can reveal this fault, that no nearer test can,
or that a farther test may be skipped. Those are outcome and risk questions the
snapshot does not record.

**The graph and the execution record must name the same files.** The scan
reads a workspace package's built output as its source when the package's
`tsconfig` names both `outDir` and `rootDir` and emits code. A package built
another way, or a graph you
supply yourself, can still name built files where the execution record names
source files. `knownAs` connects the two; without it, tests can be selected but
their distances remain `unmeasured`.

**A bearing does not establish blame.** It describes a path or a gap in the
available evidence. Use it to choose what to inspect or how an existing
integration orders work.

---

**Further:** [Test selection](selecting.md) ·
[The source scan](source.md) ·
[The execution record](execution-record.md) ·
[Distance API and options](../packages/sense/README.md#run-the-near-tests-first)
