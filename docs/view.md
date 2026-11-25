# View: a recorded test run as one page you open from disk

`variance view` turns the [execution record](execution-record.md), the file a recorded test
run leaves, into one HTML file and prints its path. The page shows which test files and cases were slowest and which were retried, where each
file sat on the run's clock, and how much of the source the run reached. It is
a single self-contained file, with no server, network or account behind it, so
you can open it from disk, attach it to a CI run as an artifact, or link it
from a pull request.

## Open it

```bash
variance view
```

The command reads the record, writes `variance-view.html` in the variance cache
directory, and prints the path. `--suite <name>` reads the record of one declared suite when the repository has
more than one. Opening the file is yours: the command starts no browser. With no record yet,
[make one first](#if-you-have-no-record-yet).

## What you see first

The header names the suite, the commit and the record the page was read from,
and counts the files recorded and the files placed on the clock. Below it sit
the tabs **Tests**, **Timeline**, **Coverage** and, unrelated to [the cadence line](test-level-coverage.md) of a case, **Cadence**, with Tests open, and a
filter box above the tables of the open tab. Tests holds the slowest test files
and the slowest cases as sortable tables, each row a link, then every case whose
attempts ended differently, then every retried case no attempt of which passed, with each attempt. The Timeline is a chart with one lane per test file;
Coverage is how much of the source the run executed. When the run cannot be
counted and no test file is known to have called into a source file, there is
no Coverage tab, and the header says coverage was not counted.

## What each tab shows

- **Tests** lists the slowest test files and the slowest cases, and every case
  whose attempts ended differently or never passed, with each attempt, its time and its failure message. Click a
  column header to sort, and type in the filter box to narrow the rows.
- **Timeline** draws each test file as a bar from the moment the runner started
  it, with the phases the runner timed in colour: `prepare`, `environment`,
  `setup`, `collect` and `cases`. It is the picture [`variance trace`](trace.md)
  prints as spans for a trace viewer, drawn on the page. A file without a start
  is counted in a note and not drawn, because placing it would be an invention.
  When Playwright recorded which worker lane ran a file, the bars are grouped
  under a heading per lane, with files that have no lane last under "No worker
  recorded"; a record without lanes is drawn as one list.
  Only Playwright records a start today; Tests and Coverage read what any of
  Vitest, Jest, Rstest and Playwright records.
- **Cadence** draws one point for each run the record has kept a summary row
  for: its total duration against the time it landed, with the suite and case
  count in a table beneath. Here "cadence" means how often runs land and how
  long each took; it is not the per-case first-test `cadence` line of
  test-level coverage. Each recorded run
  appends one row (time, suite, total duration, case count) to
  `coverage.rows.json` beside the record, and a row older than four weeks goes
  when the next run lands, with at most four hundred kept. A cache with one row
  draws one point, and one with none draws an empty tab. A run that could not
  tell its duration draws a hollow point on the baseline and is not lent a
  duration. No outcome counts are kept.
- **Coverage** shows how much of your source code the run executed, split by
  suite, kind of test and package, and below that each source file with the test
  files that called into it. When the run cannot be counted that way, the page says so
  in a chip and still opens; the list of which test files called into which source
  file needs only the record.

Click a test file anywhere and its pane opens, with these headings:
**Attempts** for its cases that ended differently, **Phases and place** on the timeline, and
**Source files reached**, each a link to that file in Coverage. A source file in
Coverage links back to the test files that called into it, when the record has
that. A test file the page holds no pane for is named there without a link.

## If you have no record yet

The record lives in your [cache](cache.md) and holds, per test file, its time
and which source files its tests ran. To make one, install `@variance-authority/sense` and
`@variance-authority/cli` (Playwright also takes
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

- Every list is cut to its first hundred rows by the command, so the page stays
  a size a browser opens at once; the filter searches those rows only.
- The Timeline draws no case: a file's bar shows its phases, and a count of its
  cases is in the bar's tooltip, as [the trace](trace.md#what-a-trace-shows-and-what-it-does-not)
  places cases only in recorded order.
- A record made before Playwright carried starts has no Timeline.
- A suite you name that has no record says so on the Tests tab and on the Timeline, and nothing is read from it.
- The rows live in the cache with the record, so they travel as far as it does:
  a CI cache restored from main carries them forward, but a run that fails, or
  a cache that is not saved, loses its rows, and a share or a worktree's own
  layer starts with none. Without the Playwright reporter each worker records
  its own row.
- A pane exists only for the test files the page holds a row for.

## Reference: addresses

Read this to share a link to one test, or to open the page at a filtered view.

The address is the page's position: `#tests`, `#timeline` or `#coverage`;
`#<tab>/<needle>` opens a tab with the needle in its filter and its row marked;
`#test/<file>` opens one test file's pane, which has no tab of its own.
