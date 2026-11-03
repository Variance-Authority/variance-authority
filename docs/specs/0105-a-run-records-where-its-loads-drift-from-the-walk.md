# Spec 0105 — a run records where its loads drift from the walk

**Missing:** a record of where a run's loads left the walk's prediction, kept
with the record and compared run to run. The check exists:
[`unreachedLoads`](../../packages/sense/src/test-selection/closed-world.ts)
names each test file that loaded a file its imports do not reach, and nothing
calls it. Over this repository's unit record it names 923 loads, 566 of them
from one helper that loads the CLI through `createRequire` and a dynamic
`import()`, and nothing tells which of them are the runner doing what it was
set up to do and which are new. Inside the record, one runner is already held
to the second half of the funnel: a Jest file fails when its CommonJS registry
holds a module whose probes registered and its journal never entered
([`jest-registry.cts`](../../packages/sense/src/test-selection/jest-registry.cts)).
Nothing holds an ES module, Vitest's module graph, a bundler's module list or a
Playwright page to the same rule.
**Built on:** the check above and its fixture
([`closed-world.integration.test.ts`](../../packages/sense/src/test-selection/closed-world.integration.test.ts));
the mocks a test declares, read off its tree
([`mocks.ts`](../../packages/sense/src/taint/mocks.ts)); the evaluation a runner
makes of a module it mocks, disowned at load time
([`shadowed.ts`](../../packages/sense/src/test-selection/shadowed.ts)); the
precision ladder and its union
([`precision.ts`](../../packages/sense/src/test-selection/precision.ts)); the
record a suite's mainline published
([`mainline-base.ts`](../../packages/cli/src/commands/mainline-base.ts),
[`mainline-layer.ts`](../../packages/sense/src/test-selection/mainline-layer.ts));
and the file use a test file records,
[ADR-0095](../context/adr/0095-a-test-file-records-what-it-loaded.md).

## Purpose

Selection is a funnel. Each step answers from a finer reading than the one
before it, and each selects the same tests or fewer:

```text
reach  ⊇  files(coverage)            the walk holds every file the run entered
file use  ⊇  files(function ∪ region)  every entered file was recorded as loaded
```

The first inclusion is a prediction, and runners break it on purpose. Jest's
`moduleNameMapper`, a bundler alias, a `__mocks__` file, automock and a setup
file each make a specifier mean something its text does not say. Holding the
walk to the record by teaching it every runner's rules takes a model of every
mapping a project can write, and each one it misses reads as a breach. So the
walk is not taught. The run writes down where it drifted, and that drift is
judged against the last drift its mainline recorded.

**Drift** is the loads of a test file that its imports, the suite's `before`
files and the mocks the runner served do not reach: the rows `unreachedLoads`
returns, one per test file and loaded file. It is a reading of the record, not
a configuration and not a second table of imports. It never joins the graph
and never changes what a selection runs: the union at `file` and `symbol`
already keeps every file the record holds, and stays.

Absent means absent from a file the record measured. A file outside every
instrumented root is not in `whole`
([spec 0046](0046-the-safety-rule-lives-in-one-place.md)), and it is never
drift.

## The mainline's drift is the baseline

A run that writes a record with `relations` on computes its drift once, where
the record is written, and the record carries it. The drift in the record the
suite's mainline published is the **baseline**. Accepting it is publishing it:
there is no file to write by hand, and no tracked file moves, because a record
is not part of git.

A suite with no published record has no baseline. Its first run reports its
drift as the baseline it will publish, named and counted, not as a change.

A suite with `relations: false` has no walk, so it has no drift. The record
says the first inclusion was not checked, and it is never reported as held.

## A run reports where the shape changed

A later run compares its drift with the baseline's, test file by test file,
for the test files it ran. A row the baseline lacks has **grown**; a baseline
row the run lacks has **shrunk**. A test file the run did not run keeps its
baseline rows and is not compared: absence selects nothing.

A shape change is reported with the test file and the loaded file. It is never
silent, and never folded into the record without a line in the report. On the
mainline the run's drift becomes the next baseline, and the report names what
it took in. On a pull request the report names it, so the pull request that
brings in a dynamic import by a computed name, a mapper entry or an
`import.meta.glob` says so.

A shape change is not a failure. Every row of it was recorded by a test that
ran, so the record already holds what selection needs for that test, and
failing a correct change on a correct record is a false positive. What a row
asks for is a decision. A load the walk should have read —
`import.meta.glob`, `createRequire().resolve` of a literal, a resolver defect —
is a defect in Variance and is fixed here. A load the runner was set up to make
stays in the baseline.

## A suite with a baseline is closed

The world is not declared. A suite is closed once it has a baseline: from then
on every load its record holds is explained, by the walk or by a baseline row,
and a load explained by neither is a shape change the report names. Before it
has one, its first run's drift is the whole picture, reported as such.

Code that runs in another process — a deployed service, a worker's binding, a
browser beside the runner — is not in the record, so it is not drift and no
baseline sees it. That part of a suite stays open, and this spec does not close
it.

## File use missed a load

The second inclusion is different in kind. A file whose functions or regions a
test entered and whose load the test did not record is a gap in the recorder:
a loader the hook does not see, a cache hit served before it, a module
evaluated in another realm. No runner configuration explains it and no
baseline excuses it. It fails the run that recorded it, naming the file and the
test, as Jest's CommonJS registry already does, carried to every runner.

Some runtimes give no module hook, and the Workers runtime is one. There file
use is inferred from region coverage: a file is used when the run entered any
region of it. The record marks which it holds. Where file use is inferred, the
second inclusion is true by construction, so its check is skipped and named,
never reported green. Inference is exact only when coverage includes each
module's top-level range, which evaluation always enters; from function
coverage alone it is a lower bound.

## Shards

Work done once per shard, module evaluation above all, is a precondition of
every case that shard served. A Cloudflare Workers isolate is a shard: it
evaluates the worker's modules once and serves many requests. Its record is
the isolate's, its file use is the isolate's evaluation charged to every case
the isolate served, and its drift is read the same way.

## Cost

Drift is computed once per record written, never per selection, so coverage
selection still takes no graph. `unreachedLoads` walks each test file forward
once and costs what the record lists: 13–74 ms per record on this repository,
and 2.1 s on a synthetic graph of 425,000 nodes and 6.3 million loads. Its rows
are few beside the file use they are read from.

## What discharges it

- Where a run writes a record with `relations` on, the record carries its
  drift, computed by `unreachedLoads`; with `relations: false` it carries none
  and says the first inclusion was not checked.
- A run reads the baseline from the record its mainline published, and reports
  grown and shrunk rows for the test files it ran. A run with no baseline
  reports its drift as the baseline.
- The Jest fixture of `closed-world.integration.test.ts` — a mapper for styles
  and a path alias, `__mocks__` beside a module and under the root, automock
  with opt-outs, `requireActual`, `isolateModules` and a setup file — recorded
  twice reports no shape change the second time. A run that adds
  `dynamic.case.ts` to a baseline without it reports exactly one grown row,
  `math.ts` from `dynamic.case.ts`, and fails first on today's code, which
  reports nothing.
- A Vitest fixture with `resolve.alias`, `vi.mock` with and without a factory,
  `importOriginal` and `vi.resetModules` does the same.
- A fixture whose journal loses an ES module, under Jest and under Vitest,
  fails the run the way `jest-registry.integration.test.ts` fails a lost
  CommonJS module, and fails first.
- A record carries whether its file use was recorded or inferred, and the file-
  use check reports itself skipped where it was inferred.
- The `it.todo` in `closed-world.test.ts` that fails a closed suite's run is
  replaced by the drift the record carries.

## Not here

Drift is kept per test file, which is enough to report it and to judge it. It
cannot speak for a test file that did not run. That needs the importer that
made each load, so a new row `importer → file` holds for every test the walk
takes through that importer. Vitest's `resolveId` and Node's `resolve` hook are
handed the importer; the `it.todo` in `closed-world.test.ts` that names the
request the runner answered stays for it.
