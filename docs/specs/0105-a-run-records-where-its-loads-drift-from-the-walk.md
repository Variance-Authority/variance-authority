# Spec 0105 — a run records where its loads drift from the walk

**Missing:** a reading of where a run's loads left the walk's prediction,
compared with the mainline's and reported on the pull request. The check
exists: [`unreachedLoads`](../../packages/sense/src/test-selection/closed-world.ts)
names each test file that loaded a file its imports do not reach, and nothing
calls it. When it landed, it named 923 loads over this repository's unit
record, 566 of them from one helper that loads the CLI through `createRequire`
and a dynamic `import()`, and nothing tells which of them are the runner doing
what it was set up to do and which are new.
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
file each make a specifier mean something its text does not say. A suite that
declares its world closed fails a correct change whenever the runner maps one
of them, and holding the walk to the record takes, for every runner, the file
it served for each importer's specifier. So nothing is declared and nothing is
carried per importer. The record already holds what each test file loaded, and
where that leaves the walk is judged against where the mainline's left it.

**Drift from the walk** is the loads of a test file that its imports and the
suite's `before` files do not reach: one row per test file and loaded file. It
is a reading of the record against the walk, not a configuration and not a
second table of imports. It never joins the graph and never changes what a
selection runs: the union at `file` and `symbol` already keeps every file the
record holds, and stays. Whoever changes the walk reads its rows as the walk's
misses, each one a resolver defect or a load no source names.

A mock the runner served is drift like any other runner-made load, and sits in
the baseline from the first run. `unreachedLoads` today exempts a `__mocks__`
file whose original the test reaches or mocks, or whose package it reaches;
that is the runner's mapping guessed from a path, the rule this spec drops, and
it is deleted when drift is wired. A mock a test declares in its own text —
`jest.mock`, `vi.mock` — is read off the tree as a cut, and an original its
factory loads as an edge, and both stay.

Absent means absent from a file the record measured. A file outside every
instrumented root is not in `whole`
([spec 0046](0046-the-safety-rule-lives-in-one-place.md)), and it is never
drift.

## The mainline's drift is the baseline

Drift is read in one place: `variance review`, which already fetches the
mainline's record through `mainlineBase`, holds the pull request's record and
builds the checkout's graph. The run that writes a record does not read it, so
recording costs what it does today and every runner's record is read the same
way.

The **baseline** is the drift of the mainline's record at the pull request's
merge base, read against the graph of the merge base. The pull request's drift
is its record read against the graph of its checkout. Both walks are made by
the Variance that compares, so a resolver fix or a release moves both sides
together, and a pull request that removes an import or renames a file a test
loaded moves its walk and its file use together, so neither reads as a shape
change nobody made. Each side's walk reads that side's suite configuration too
— its `before` files, its aliases, its `relations` — so a pull request that adds
a setup file is read against its own. A load that stays after its import is
removed, through a setup file, a mapper or a dynamic import, is drift the pull
request made, and reads as grown. Nothing is stored for it: drift is derived from the file
use the record already holds, so the record does not grow. Accepting it is
publishing the record: there is no file to write by hand, and no tracked file
moves, because a record is not part of git.

A record at any other commit is not a baseline. One past the merge base holds
the mainline's own changes since the branch point, and one behind it misses
them; either would name another pull request's change on this one. When the
mainline's record is not at the merge base, or there is none, or the records
are not shared, the review names which and how many commits away the record
is, and compares nothing.

A suite with `relations: false` has no walk, so it has no drift. Nor has a
suite whose test files share a realm — Vitest's `isolate: false`, a reused page
— for what such a file loads depends on what ran before it in the same worker.
The review says the first inclusion was not checked for either, and it is never
reported as held.

## What is compared

A record is layered: the rows of a test file can come from an older commit
than the record's own, where the mainline's run passed over it, or where the
pull request's run landed it at an earlier head. A row read against a graph it
was not recorded on is a false row, so a test file is compared only when both
sides observed it whole at their own commit: the mainline's run at the merge
base, and the pull request's run at its head, each running the file to the end
with the same cases. Both records also share the recorder's format and recipe;
when they do not, the review names the skew and compares nothing. Every test
file left out is counted under its reason — standing at an older commit, ran at
an older head, failed or filtered — and never compared.

## A review reports where the shape changed

The review compares the pull request's drift with the baseline's, test file by
test file, for the test files both sides observed. A row the baseline
lacks has **grown**; a baseline row the run lacks has **shrunk**. A test file
the run did not run keeps its baseline rows and is not compared: absence
selects nothing. A test file the pull request renamed or deleted is listed as
removed. A test file the baseline does not hold, because it is new or
its record was not made, has no rows to compare; its drift is listed apart, as
the first it records, not as grown.

A shape change is written into the comment CI posts on the pull request, with
the test file and the loaded file. It is never silent. So the pull request that
brings in a dynamic import by a computed name, a mapper entry or an
`import.meta.glob` says so.

A shape change is not a failure. Every row of it was recorded by a test that
ran, so the record already holds what selection needs for that test, and
failing a correct change on a correct record is a false positive. What a row
asks for is a decision. A load the walk should have read —
`import.meta.glob`, `createRequire().resolve` of a literal, a resolver defect —
is a defect in Variance and is fixed here. A load the runner was set up to make
stays in the baseline once the pull request merges.

## A baseline explains every load

Once a suite has a baseline, every load its record holds is explained, by the
walk or by a baseline row, and a load explained by neither is a shape change
the review names. That is what closing the world comes to for the loads a
record holds: nothing is declared, and nothing fails.

Code that runs in another process — a deployed service, a worker's binding, a
browser beside the runner — is not in the record, so it is not drift and no
baseline sees it. That part of a suite stays open, and this spec does not close
it.

## Cost

Drift is computed by the review, never per selection and never by the run, so
coverage selection still takes no graph and recording takes no more time. The
review already builds the checkout's graph; the merge base's graph is the one
it adds, and its cost is measured against the review's own time with the
change that wires it. `unreachedLoads` itself walks each test file forward once
and costs what the record lists: 13–74 ms per record on this repository, and
2.1 s on a synthetic graph of 425,000 nodes and 6.3 million loads. Its rows are
few beside the file use they are read from.

## What discharges it

- `variance review` with `relations` on writes the drift's shape change into
  the pull request's comment; with `relations: false` it says the first
  inclusion was not checked. No runner seam computes or prints drift.
- The baseline is the mainline's record at the merge base, fetched through
  `mainlineBase`, read against the merge base's graph; the record carries no
  drift of its own. A record at another commit, none, or records not shared is
  named with the reason and the distance, and nothing is compared.
- Grown and shrunk rows are reported only for test files both sides observed
  whole at their own commit; a test file the run did not run is not compared,
  one the baseline lacks is listed apart as its first drift, and one the pull
  request removed is listed as removed.
- A mainline test file standing at a commit older than the merge base, a pull
  request's test file landed at an earlier head, a failed or filtered file, and
  records of different recorder formats are each counted under their reason and
  not compared.
- A suite whose files share a realm is named as not checked.
- Renaming a file a test reaches only through drift reports one shrunk and one
  grown row under the exact names.
- The Jest fixture of `closed-world.integration.test.ts` — a mapper for styles
  and a path alias, `__mocks__` beside a module and under the root, automock
  with opt-outs, `requireActual`, `isolateModules` and a setup file — reviewed
  against itself reports no shape change. Adding a computed-name load to a test
  file the baseline holds reports exactly one grown row, and removing it
  reports exactly one shrunk row; both fail first on today's code, which
  reports nothing.
- Removing a static import from that fixture, and renaming a file a test loads
  through one, report no shape change.
- Drift is read from every record that holds file use, whatever runner wrote
  it. Jest and Vitest records hold it today, and each gets a fixture: the
  Vitest one has `resolve.alias`, `vi.mock` with and without a factory,
  `importOriginal` and `vi.resetModules`, reports no shape change against
  itself and one grown row for an added computed-name load, and fails first.
  A runner whose record holds no file use is named as not checked.
- `closed-world.ts` is named and documented for drift, not for a declared
  world, and its `__mocks__` exemption is deleted. The `it.todo` in
  `closed-world.test.ts` that fails a closed suite's run is replaced by the
  review's shape change.

## Not here

Drift is read per test file, which is enough to report it and to judge it. It
cannot speak for a test file that did not run. That needs the importer that
made each load, so a new row `importer → file` holds for every test the walk
takes through that importer. Vitest's `resolveId` and Node's `resolve` hook are
handed the importer. The `it.todo` in `closed-world.test.ts` that names the
request the runner answered is reworded to ask for that importer, and stays.

The old spec's `open: [parts]` and declared jump files are dropped with the
declared world: drift needs neither.
