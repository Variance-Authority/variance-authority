# Spec 0105 — a run records where its loads drift from the walk

**Missing:** a record of where a run's loads left the walk's prediction, kept
with the record and compared run to run. The check exists:
[`unreachedLoads`](../../packages/sense/src/test-selection/closed-world.ts)
names each test file that loaded a file its imports do not reach, and nothing
calls it. Over this repository's unit record it names 923 loads, 566 of them
from one helper that loads the CLI through `createRequire` and a dynamic
`import()`, and nothing tells which of them are the runner doing what it was
set up to do and which are new.
**Built on:** the check above and its fixture
([`closed-world.integration.test.ts`](../../packages/sense/src/test-selection/closed-world.integration.test.ts));
the mocks a test declares, read off its tree
([`mocks.ts`](../../packages/sense/src/taint/mocks.ts)); the precision ladder
and its union
([`precision.ts`](../../packages/sense/src/test-selection/precision.ts)); the
record a suite's mainline published
([`mainline-base.ts`](../../packages/cli/src/commands/mainline-base.ts),
[`mainline-layer.ts`](../../packages/sense/src/test-selection/mainline-layer.ts));
the review a pull request's comment is written from
([`review-text.ts`](../../packages/cli/src/commands/review-text.ts)); and the
file use a test file records,
[ADR-0095](../context/adr/0095-a-test-file-records-what-it-loaded.md). The
second half of the funnel, file use holding every file a test entered, is
[spec 0108](0108-file-use-holds-every-file-a-test-entered.md).

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

**Drift** is the loads of a test file that its imports and the suite's
`before` files do not reach: one row per test file and loaded file. It is a reading of the record
against the walk, not a configuration and not a second table of imports. It
never joins the graph and never changes what a selection runs: the union at
`file` and `symbol` already keeps every file the record holds, and stays.

A mock the runner served is drift like any other runner-made load, and sits in
the baseline from the first run. `unreachedLoads` today exempts a `__mocks__`
file whose stem matches a module the test reaches; that is the runner's mapping
guessed from a path, the rule this spec drops, and it is deleted when drift is
wired. A mock a test declares in its own text — `jest.mock`, `vi.mock` — is an
edge the walk already reads off the tree, and stays one.

Drift is for two readers. Whoever changes the walk reads it as the walk's
misses, each one a resolver defect or a load no source names. And `relations`,
which decides alone for a test file with no record, is trusted as far as drift
on the files that have one says it can be.

Absent means absent from a file the record measured. A file outside every
instrumented root is not in `whole`
([spec 0046](0046-the-safety-rule-lives-in-one-place.md)), and it is never
drift.

## The mainline's drift is the baseline

The **baseline** is the drift of the record the suite's mainline published,
fetched by `mainlineBase` and by nothing else, read against the walk of the
checkout that compares. The record a branch writes for itself is never the
baseline: it would hide the branch's own growth after its first run. Nothing is stored for it:
drift is derived from the file use the record already holds, so the record does
not grow, and a change to the walk itself — a resolver fix, a release of
Variance — moves the baseline and the run together instead of reading as a
shape change nobody made. Accepting it is publishing the record: there is no
file to write by hand, and no tracked file moves, because a record is not part
of git.

A suite with no published record has no baseline. Its run reports its drift
as the baseline it would publish, named and counted, not as a change; a suite
whose records are not shared keeps saying so on every run, and the report names
that as the reason.

A suite with `relations: false` has no walk, so it has no drift. The record
says the first inclusion was not checked, and it is never reported as held.

## A run reports where the shape changed

A later run compares its drift with the baseline's, test file by test file,
for the test files it ran. A row the baseline lacks has **grown**; a baseline
row the run lacks has **shrunk**. A test file the run did not run keeps its
baseline rows and is not compared: absence selects nothing.

A shape change is reported with the test file and the loaded file, in two
places: the run that writes the record prints it, and `variance review` writes
it into the comment CI posts on the pull request. It is never silent. On the
mainline the published record becomes the next baseline, and the run names
what it took in. On a pull request the comment names it, so the pull request
that brings in a dynamic import by a computed name, a mapper entry or an
`import.meta.glob` says so.

A shape change is not a failure. Every row of it was recorded by a test that
ran, so the record already holds what selection needs for that test, and
failing a correct change on a correct record is a false positive. What a row
asks for is a decision. A load the walk should have read —
`import.meta.glob`, `createRequire().resolve` of a literal, a resolver defect —
is a defect in Variance and is fixed here. A load the runner was set up to make
stays in the baseline.

## A baseline explains every load

Once a suite has a baseline, every load its record holds is explained, by the
walk or by a baseline row, and a load explained by neither is a shape change
the report names. That is what closing the world comes to: nothing is declared,
and nothing fails.

Code that runs in another process — a deployed service, a worker's binding, a
browser beside the runner — is not in the record, so it is not drift and no
baseline sees it. That part of a suite stays open, and this spec does not close
it.

## Cost

Drift is computed where a run writes a record or a review reads one, never per
selection, so coverage selection still takes no graph. `unreachedLoads` walks
each test file forward once and costs what the record lists: 13–74 ms per record on this repository,
and 2.1 s on a synthetic graph of 425,000 nodes and 6.3 million loads. Its rows
are few beside the file use they are read from.

## What discharges it

- A run that writes a record with `relations` on prints its drift's shape
  change against the mainline's record, and `variance review` writes it into
  the pull request's comment; with `relations: false` both say the first
  inclusion was not checked.
- The baseline is read through `mainlineBase` alone, from the mainline's file
  use against the comparing checkout's walk, and the record carries no drift of
  its own. A suite whose records are not shared is named as having none.
- Drift is read from any record that holds file use, whatever runner wrote it:
  Jest and Vitest have the fixtures below, and Rstest, Playwright and the
  Storybook runner get theirs where their records first hold file use.
- Grown and shrunk rows are reported for the test files the run ran; a test
  file it did not run is not compared. A run with no baseline reports its drift
  as the baseline.
- The Jest fixture of `closed-world.integration.test.ts` — a mapper for styles
  and a path alias, `__mocks__` beside a module and under the root, automock
  with opt-outs, `requireActual`, `isolateModules` and a setup file — recorded
  twice reports no shape change the second time. A run that adds
  `dynamic.case.ts` to a baseline without it reports exactly one grown row,
  `math.ts` from `dynamic.case.ts`, and fails first on today's code, which
  reports nothing.
- A Vitest fixture with `resolve.alias`, `vi.mock` with and without a factory,
  `importOriginal` and `vi.resetModules` does the same.
- `closed-world.ts` is named and documented for drift, not for a declared
  world, and its `__mocks__` path exemption is deleted. The `it.todo` in
  `closed-world.test.ts` that fails a closed suite's run is replaced by the
  shape-change report.

## Not here

Drift is read per test file, which is enough to report it and to judge it. It
cannot speak for a test file that did not run. That needs the importer that
made each load, so a new row `importer → file` holds for every test the walk
takes through that importer. Vitest's `resolveId` and Node's `resolve` hook are
handed the importer; the `it.todo` in `closed-world.test.ts` that names the
request the runner answered stays for it.
