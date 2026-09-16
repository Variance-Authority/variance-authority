# How far the change travelled

[Test selection](selecting.md) tells you which tests to run after an edit. Distance helps you
choose which of those tests to run first. It counts paths **only through modules
the test actually entered or loaded**; a static graph alone can suggest a path
the test never took.

A change to a shared module can select most of the suite. Some selected tests
import that module directly; others depend on it through several modules.
Distance counts those import steps, or **hops**, so you can run the nearest tests
first and get feedback before the rest finish.

The report also identifies imports that bypass a public entry point and
connections that the import graph cannot explain.

## Run nearby tests first

The nearest tests usually give you the fastest useful answer. They exercise the
changed file with fewer modules in between, so a failure arrives sooner and has
fewer possible causes.

You run a range of distances rather than the whole selection. `0-2` is every
selected test no more than two imports from the change; `3-` is the rest. Run a
near range while the edit is still fresh, then the rest before treating the
change as verified.

```ts
import { atDistance, distanceRange, remaining } from '@variance-authority/sense/test-selection';

const { from, to } = distanceRange('0-2') ?? { from: 0, to: Number.MAX_SAFE_INTEGER };
const running = atDistance(distances, from, to);
const later = remaining(distances, from, to);
```

The range is hop counts, not positions in a list. If the nearest selected test
is five imports away, `0-2` runs nothing — no test is that close — and `3-` runs
all of them. Start at `0` rather than `1`: a test whose own source you edited is
at no distance from the change, and a range starting at one would leave it until
last.

Tests whose distance cannot be measured run with the range that reaches the end,
so `0-2` and then `3-` runs every selected test exactly once. `remaining` lists
the tests a partial run leaves for later. `groupByDistance` reports the whole
reading as one group per hop count, which is the table to print beside the range
you took out of it.

Passing a near range only tells you that those tests passed. The full suite is
still the verification gate.

## How agents use the distance

During the main edit loop, an agent runs `0-2`: the tests within two imports of
the change, including any whose own source it just edited. That keeps feedback
close to the code it is changing and makes a failure cheaper to explain.

Before handing the change over, the agent widens to `2-4`. CI runs the remaining
selected tests and the full project gate. The overlap at two hops is deliberate:
it reconnects the broader verification run to the closest dependency boundary
already exercised during the edit loop.

In this repository those two steps are `yarn test:since --at-distance 0-2` and
`yarn test:since --at-distance 2-4`; `yarn test:since --help` prints the rest.

## Connections worth investigating

**`reach-through` points to an import that bypasses an interface.** The report
names the importer, the internal file it imports, and the intended entry point:

```text
src/report/report.tsx imports src/button/abstract-button.tsx;
src/button is entered at src/button/index.ts
```

Start with the importing line when investigating this finding.

A *unit* here is a directory intended to be accessed through one entry file.
`indexFaces` uses directories with an `index` module to identify those entry
points. If your project defines boundaries differently, supply your own
provider. `eitherFace` lets you try that provider first, then fall back to
`indexFaces`. A workspace can use package manifests to define its boundaries.

**`unexplained` means there is a recorded connection without a matching import
path.** Shared state, a registry, or a patched prototype are possible causes.
The label does not identify which one is responsible. It appears only when the
graph accounts for the rest of the run; otherwise the result is `unmeasured`.

Both findings are reported even when the tests pass. They identify places to
investigate, not proof of a failure or its cause.

**`unmeasured` means information is missing.** The graph might omit a built
artifact, an unscanned directory, or a file's imports. The reason tells you
which gap prevented measurement.

A missing distance stays absent. It is never reported as zero, because zero
means the test's own source or a precondition changed. Missing graph data must
not look like either a nearby test or an unexplained connection.

## Example from this repository

For a one-line change to `packages/core/src/format/canonical.ts`, the
repository's recorded selection contains 259 of 377 test files:

```text
test:since: 259 of 377 files, at 8 distance(s).
  base     92fcbeb5a44e — where the snapshot was recorded
  changed  1 path(s): 1 measured, 0 test file(s), 0 the suite cannot open
  skipped  118 file(s) the snapshot saw whole and which entered none of it

    1  hop            1 file(s)
    2  hops         101 file(s)
    3  hops          57 file(s)
    4  hops          39 file(s)
    5  hops          19 file(s)
    6  hops           3 file(s)
    9  hops           1 file(s)
    ·  unplaced      38 file(s)

  0-2 hops: running 102, leaving 157 for a later leg.
  A green leg is not a green suite, and `yarn test` is still the gate.
```

The left column is the hop count, and it is also what you pass to
`--at-distance`. In this measurement `0-1` is the single test file that imports
the changed module directly, and it finishes in under two seconds. `0-2` runs
102 files in 17 seconds, `3-` runs the remaining 157 in 15, and the whole suite
takes 25.

**Distance does not predict runtime.** Nearby tests can be slow, and splitting
a run can increase total time. The benefit is earlier, focused feedback: a
shorter import path gives you fewer intermediate modules to investigate.

## How distance is measured

Distance combines the import graph with the record of what each test ran. It
finds the shortest path between the changed file and the test, using only
modules that test entered or loaded. If several changed files select the same
test, the nearest determines its distance.

An import graph alone can suggest a shorter path through a module the test
never loaded. The [execution record](execution-record.md) rules out that path.

```ts
import {
  distanceByExecution,
  indexFaces,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';

const { narrowing, distances } = await distanceByExecution(
  testCoverageFile(process.cwd()),
  diff,
  { relations, faces: indexFaces(relations) },
);
```

This reads the coverage file once and returns both the
[selected tests](selecting.md) and their distances. `relations` supplies the
import graph. The traversal does not read files itself, so you can use a graph
your repository already builds.

The other options describe how to interpret that graph:

- `knownAs` connects different names for the same module, such as a source file
  in the execution record and its built output in the import graph.
- `faces` identifies public entry points, so the report can flag imports that
  bypass them.
- `enumerated` says whether a file's imports were scanned. Without it, the
  traversal assumes every file in the graph was fully scanned.

## What the labels mean

Each selected test has a **bearing**: a label describing its connection to the
change.

| Bearing | Meaning |
|---|---|
| `precondition` | The test's own source or a recorded precondition changed. Zero hops. |
| `direct` | The test imports the changed module directly, without bypassing a public entry point. One hop. |
| `transitive` | The path passes through other modules without bypassing a public entry point. More than one hop. |
| `reach-through` | An import on the path bypasses a unit's public entry point and accesses an internal file. |
| `unexplained` | The graph accounts for the rest of the test's run but has no import path connecting it to the change. |
| `unmeasured` | The graph lacks enough information to determine the distance. The report includes a reason. |

The first four labels include a hop count. `unexplained` and `unmeasured` do not.
A longer path is not itself a problem: several modules connected through their
public interfaces can be an ordinary part of the design.

## Limits

**Distance describes the recorded execution.** It cannot provide a path for a
branch that no recorded test took. Selection handles changes it cannot
attribute by running everything; see [test selection](selecting.md) for those
rules. Distance does not extend that guarantee to unseen execution paths.

**The graph must connect source files to built output.** In a workspace,
cross-package imports can resolve to built files while the execution record
names source files. Without that connection, tests can be selected but their
distances remain `unmeasured`. Supply the mappings from published entries to
source through the graph and `knownAs`.

**A bearing does not establish blame.** It describes a path or a gap in the
available evidence. Use it to choose what to run or inspect next.

---

**Further:** [Test selection](selecting.md) ·
[The source scan](source.md) ·
[The execution record](execution-record.md) ·
[Distance API and options](../packages/sense#place-a-selection-by-how-far-the-change-travelled)
