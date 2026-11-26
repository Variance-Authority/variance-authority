# View: the execution record as one page you open from disk

`variance view` turns the [execution record](execution-record.md), the file a
recorded test run leaves, into one HTML file and prints its path. The page holds
the whole record and reads it in your browser: every test file, case, source
file and region the run recorded, with nothing cut. It is a single
self-contained file, with no server, network or account behind it, so you can
open it from disk, attach it to a CI run as an artifact, or link it from a pull
request.

## Open it

```bash
variance view
```

The command reads the record, writes `variance-view.html` in the variance cache
directory, and prints the path. `--suite <name>` reads the record of one
declared suite when the repository has more than one; without it, the first
declared suite that has a record is read. Opening the file is yours: the command
starts no browser. With no record yet, [make one first](#if-you-have-no-record-yet).

## What you see first

The **Overview** opens first: the suite, the commit, how the run was recorded,
and how many test files, cases, source files and regions the record holds. A row
of tabs sits above it, one for each part of the record that is present, and
**Record** last. A tab holds one or more tables. Each table has a filter box
that keeps the rows with a cell containing what you type, and each column header
sorts it, the first click largest first.

## What each tab shows

- **Test files**: every test file with its time, when it started and on which
  worker where the runner gave them, how many cases and regions it reached, and
  whether its recording finished.
- **Cases**: every case the runner reported, with its time, its limit, how it
  ended and how many regions it entered. Present when the record has a case
  index.
- **Timeline**: each test file by worker, placed on the run's clock. A file
  whose runner gave no start is counted and not placed. Only Playwright records
  a start today.
- **Modules**: every source file, with its regions, those no test entered, and
  how many test files reached it.
- **Regions**: every function, branch and module body, with its lines and how
  many test files entered it.
- **Preconditions**: what each test file was recorded under.
- **Before the last run**: the cases and regions the record kept from the run
  before, where it kept them.
- A tab for each other part the record carries, such as retried attempts, shown
  as it is stored.
- **History**: every record the [share](sharing.md) keeps of the mainline in
  the last two weeks, one row per commit and suite: when it ran, how long it
  took, its test files and cases, the cases it retried and the time their
  earlier attempts cost. It adds each test file's mean time over the window,
  each retried case with the commits it was retried on, and the commits whose
  suite time moved most from the one kept before, with the test files that
  moved it. `--since <n>d` or `--since <n>w` widens or narrows the window.
  Where there is no series to draw, because no share is configured or it keeps
  nothing in the window, the tab says why.
- **Record**: every section of the file with its size; open one to see its
  rows.

Every name in a table is a link. A test file opens what it holds: its cases, the
regions it entered and its preconditions. A source file opens its regions and
the test files that entered it; a region opens the test files that entered it.

## If you have no record yet

The record lives in your [cache](cache.md) and holds, per test file, its time
and which source files its tests ran. To make one, install
`@variance-authority/sense` and `@variance-authority/cli` (Playwright also takes
`@variance-authority/playwright-test`), wrap your runner's configuration with
[the seam supported frameworks names for it](supported-frameworks.md#record-which-tests-ran-each-line),
and run the suite as you already do:

```bash
npx vitest run
npx jest
npx rstest run
npx playwright test
```

[Run the tests an edit needs](test-an-edit.md#wrap-once-then-set-one-variable)
covers the install and the wrap for these four, and
[Record a run](trace.md#record-a-run) says how to keep the record at a path you
name in CI.

## Limits

- The page is as large as the record, compressed: a record of a few thousand
  test files makes a page of a few megabytes.
- The page decompresses the record itself, with `DecompressionStream`, which
  every current Chrome, Edge, Firefox and Safari has.
- With no record on disk, the command writes no page and names where it looked.
- The History tab reads every kept record in the window whole, once: the first
  open of a wide window fetches each one and says on stderr how far it has
  got. What it learnt from each record is kept in the cache under the record's
  digest, so the next open reads only the records kept since.

## Reference: addresses

Read this to share a link to one row.

The address is the page's position: `#<tab>` opens a tab, such as `#files` or
`#modules`, and `#<kind>/<name>` opens one row: `#test/<file>`, `#module/<file>`,
`#case/<id>` or `#section/<name>`, the name percent-encoded. An address that
names nothing the record holds says so.
