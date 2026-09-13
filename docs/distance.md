# How far the change travelled

Test selection tells you which tests to run after an edit. Distance helps you
choose which of those tests to run first.

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

Distance groups the selected tests into **bands**, nearest first. You can run a
few bands while the edit is still fresh, then run the rest before treating the
change as verified.

```ts
import { bandRange, bandsOf, slice, tail } from '@variance-authority/sense/test-selection';

const bands = bandsOf(distances);
const { from, to } = bandRange('1-3') ?? { from: 1, to: bands.length };
const running = slice(bands, from, to);
const later = tail(bands, from, to);
```

`1-3` means the first three groups that actually contain tests. If the selected
tests are one and four imports away from the change, those become bands 1 and 2;
there are no empty bands between them. `3-` means the third band onwards.

Tests whose distance cannot be measured go in the final band. Running `1-3`
and then `4-` therefore runs every selected test exactly once. `tail` lists the
tests that a partial run leaves for later.

Passing an early band only tells you that those tests passed. The full suite is
still the verification gate.

## How agents use the distance

During the main edit loop, an agent can run the tests reported at one or two
hops. That keeps feedback close to the code it is changing and makes a failure
cheaper to explain.

Before handing the change over, the agent expands verification to the tests
reported at two through four hops. CI runs the remaining selected tests and the
full project gate. The overlap at two hops is deliberate: it reconnects the
broader verification run to the closest dependency boundary already exercised
during the edit loop.

The CLI ranges select occupied bands rather than literal hop numbers, so the
agent reads the report and chooses the bands carrying those hop counts. A
missing hop count does not create an empty band.

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

For a one-line change to `packages/core/src/format/canonical.ts`, the repository's
recorded selection contains 256 of 377 test files:

```text
test:since: 256 of 377 files, in 8 band(s).
  base     8c7d2f5dcf1b — where the snapshot was recorded
  changed  1 path(s): 1 measured, 0 test file(s), 0 the suite cannot open
  skipped  121 file(s) the snapshot saw whole and which entered none of it

    1  1 hop          1 file(s)
    2  2 hops       101 file(s)
    3  3 hops        56 file(s)
    4  4 hops        38 file(s)
    5  5 hops        21 file(s)
    6  6 hops         3 file(s)
    7  9 hops         1 file(s)
    ·  unplaced      35 file(s)

  band 1-3: running 158, leaving 98 for a later leg.
  A green band is not a green suite, and `yarn test` is still the gate.
```


In this measurement, the first three bands take 17 seconds and the remaining
bands take 49 seconds. Against a bad edit, the first band contains one test and
reports a failure in 2.3 seconds; the whole suite takes 49 seconds.

**Distance does not predict runtime.** Nearby tests can be slow, and splitting
a run can increase total time. The benefit is earlier, focused feedback: a
shorter import path gives you fewer intermediate modules to investigate.

## How distance is measured

Distance combines the import graph with the record of what each test ran. It
finds the shortest path between the changed file and the test, using only
modules that test entered or loaded. If several changed files select the same
test, the nearest determines its distance.

An import graph alone can suggest a shorter path through a module the test
never loaded. The execution record rules out that path.

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
[Reading the source graph](source.md) ·
[The execution record](execution-record.md) ·
[Distance API and options](../packages/sense#place-a-selection-by-how-far-the-change-travelled)
