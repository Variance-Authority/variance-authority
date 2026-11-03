# Spec 0105 — a run records where its loads drift from the walk

**Missing:** the Vitest fixture that holds the review to a second runner's
record, the check that names a suite whose test files share a realm as not
checked, and the importer that made each load. The review reads where a run's
loads left the walk against where the mainline's did and writes the shape change
into the pull request's comment
([`review-drift.ts`](../../packages/cli/src/commands/review-drift.ts)), comparing
the rows test file by test file
([`drift-change.ts`](../../packages/sense/src/test-selection/drift-change.ts))
against the merge base's walk, the checkout's with the change's edges undone
([`base-edges.ts`](../../packages/sense/src/test-selection/base-edges.ts)).
**Built on:** the reading above and its fixture
([`drift.integration.test.ts`](../../packages/sense/src/test-selection/drift.integration.test.ts));
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
record holds, and stays.

Drift is an observed difference, not a defect. A row says the run loaded a file
the walk does not reach; it does not say why. A `moduleNameMapper` entry, a
setup file, a computed `require`, a lazy `import()` behind a flag, an
environment variable a config reads: each makes a load the source names nowhere
as an edge, and each can move between two runs with no edit to the graph. A
row the walk should have read — `import.meta.glob`, `createRequire().resolve`
of a literal, a resolver defect — is one cause among these, and the row alone
never tells which.

A mock the runner served is drift like any other runner-made load, and sits in
the baseline from the first run. No `__mocks__` file is exempt by its path: that
would be the runner's mapping guessed from a path, the rule this spec drops. A
mock a test declares in its own text —
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

The **baseline** is the drift of the mainline's record, read against the graph
of the pull request's merge base. The pull request's drift
is its record read against the graph of its checkout. Both walks are made by
the Variance that compares, so a resolver fix or a release moves both sides
together, and a pull request that removes an import or renames a file a test
loaded moves its walk and its file use together, so neither reads as a shape
change nobody made. Each side's walk reads that side's suite configuration too
— its `before` files, its aliases, its `relations` — so a pull request that adds
a setup file is read against its own. A load that stays after its import is
removed, through a setup file, a mapper or a dynamic import, is drift the pull
request made, and reads as grown, though the graph is what moved. Nothing is stored for it: drift is derived from the file
use the record already holds, so the record does not grow. Accepting it is
publishing the record: there is no file to write by hand, and no tracked file
moves, because a record is not part of git.

The merge base's graph is the checkout's with the change undone where it moved
an edge, walked from the `before` files the merge base's own config declares.
Each file the change edits is read in both texts, every specifier each text
loads is resolved — bare imports and re-exports too — and the two texts'
targets are compared as sets: a target the pull request added is not walked at
the merge base, one it removed is, and one both texts reach stays however
often either names it. A file the change
created is not entered at the merge base. A test file whose baseline loads a
file the change deleted, or reaches one through an import that no longer
resolves, has no merge-base walk to read it against, and is counted, not
compared. A merge base whose config cannot be read has no `before` to walk
from, and the review names why and compares nothing. A change to what the walk
or the run rests on — the `before` files it declares, a file their closure holds, or an install that moved a package or may have
moved any — moves the walk itself, so the review compares as it does for any
change and names that file or package beside the rows as their cause: a mapper
entry or a bumped package is the change whose load shape a reader most needs to
see.

The mainline's record need not stand at the merge base. A record from an
earlier or a later mainline commit is a **compatible** baseline when the
commits between it and the merge base touch no file the walk reads, declare the
same `before` at both ends, move no file under it and install the same
packages, read off those commits' own diff whatever the pull request changed:
their record would be the same reading of the same walk.
When they touch one, the baseline is **incompatible**: its drift could hold
the mainline's own changes since the branch point, or miss them, and would
name another pull request's change on this one. The review then names the
record's commit, how many commits away it is and the first file between them
that moved the walk, and compares nothing. A suite with no mainline record, or
records not shared, is named the same way.

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
failing a correct change on a correct record is a false positive. A grown row
is not a new edge and not a resolver defect until somebody reads why the file
loaded: a configuration, an environment, a lazy branch the change's run took,
or a load the walk should have read. The comment names the row; the reader
names its cause. One the runner was set up to make stays in the baseline once
the pull request merges, and one the walk should have read is a defect in
Variance, fixed here.

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
review already builds the checkout's graph; the merge base's is that graph
with the change's edges undone, so it costs a parse of each edited file's two
texts and a resolve of the imports bound in one only. `driftFromWalk` itself walks each test file forward once
and costs what the record lists: 13–74 ms per record on this repository, and
2.1 s on a synthetic graph of 425,000 nodes and 6.3 million loads. Its rows are
few beside the file use they are read from.

## What discharges it

- `variance review` with `relations` on writes the drift's shape change into
  the pull request's comment; with `relations: false` it says the first
  inclusion was not checked. No runner seam computes or prints drift.
- The baseline is the mainline's record, fetched through `mainlineBase`, read
  against the merge base's graph; the record carries no drift of its own. A
  record at another commit is compared when the commits between touch nothing
  the walk reads, declare the same `before`, move nothing under it and install
  the same packages, read off their own diff, and is otherwise named incompatible with its commit, its
  distance and the first file that moved the walk; none, or records not
  shared, is named with the reason, and nothing is compared.
- The merge base's walk starts from the merge base's own `before`; an import
  target the change added is not walked there and one it removed is, compared
  as sets of resolved targets; a test file whose baseline loads a deleted file is counted, not
  compared; a changed `before`, a file its closure holds, or an install that moved
  a package, is compared, and the review names it as the cause of the rows.
- Grown and shrunk rows are reported only for test files both sides observed
  whole at their own commit; a test file the run did not run is not compared,
  one the baseline lacks is listed apart as its first drift, and one the pull
  request removed is listed as removed.
- A mainline test file standing at a commit older than the merge base, a pull
  request's test file landed at an earlier head, a failed or filtered file, and
  records of different recorder formats are each counted under their reason and
  not compared.
- A suite whose files share a realm is named as not checked.
- The Jest fixture of `drift.integration.test.ts` — a mapper for styles
  and a path alias, `__mocks__` beside a module and under the root, automock
  with opt-outs, `requireActual`, `isolateModules` and a setup file — reviewed
  against itself reports no shape change. Adding a computed-name load to a test
  file the baseline holds reports exactly one grown row, and removing it
  reports exactly one shrunk row; both fail first on today's code, which
  reports nothing.
- Removing a static import from that fixture reports no shape change, and
  renaming a file a test loads through one counts that test file as not
  compared.
- Drift is read from every record that holds file use, whatever runner wrote
  it. Jest and Vitest records hold it today, and each gets a fixture: the
  Vitest one has `resolve.alias`, `vi.mock` with and without a factory,
  `importOriginal` and `vi.resetModules`, reports no shape change against
  itself and one grown row for an added computed-name load, and fails first.
  A runner whose record holds no file use is named as not checked.
- `drift.ts` is named and documented for drift, not for a declared world, and
  exempts no `__mocks__` file. No test fails a suite's run on drift: the
  review's shape change takes that place.

## Not here

Drift is read per test file, which is enough to report it and to judge it. It
cannot speak for a test file that did not run. That needs the importer that
made each load, so a new row `importer → file` holds for every test the walk
takes through that importer. Vitest's `resolveId` and Node's `resolve` hook are
handed the importer. The `it.todo` in `drift.test.ts` asks for that importer.

The old spec's `open: [parts]` and declared jump files are dropped with the
declared world: drift needs neither.
