# View: a recorded test run as one page you open from disk

`variance view` turns the [execution record](execution-record.md) your last
Playwright run wrote into one HTML file and prints its path. The page shows
which test files and cases were slowest and which were retried, where each
file sat on the run's clock, and how much of the source the run reached. It is
a single self-contained file, with no server, network or account behind it, so
you can open it from disk, attach it to a CI run as an artifact, or link it
from a pull request.

You need a record first. Install and configure the
[Playwright integration](start-playwright.md) and run your suite: the run
writes the record. [Record a run](trace.md#record-a-run) says what to pass to
put the record at a path you name in CI.

## What you see first

The header names the suite, the commit and the record the page was read from,
and counts the files recorded and the files placed on the clock. Below it sit
three tabs, **Tests**, **Timeline** and **Coverage**, with Tests open: the
slowest test files and the slowest cases as sortable tables, each row a link,
above a filter box, then every retried case with each attempt. The Timeline is
a chart with one lane per test file; Coverage is the coverage report's tables.

## What each tab shows

- **Tests** lists the slowest test files and the slowest cases, and every case
  that was retried with each attempt, its time and its failure message. Click a
  column header to sort, and type in the filter box to narrow the rows.
- **Timeline** draws each test file as a bar from the moment the runner started
  it, with the phases the runner timed in colour: `prepare`, `environment`,
  `setup`, `collect` and `cases`. It is the picture [`variance trace`](trace.md),
  the command that prints a run as spans for a trace viewer, prints, drawn on
  the page. Only Playwright records a start; a file without one is counted in a
  note and not drawn, because placing it would be an invention.
- **Coverage** is the [coverage report](compare-coverage.md), the account of how
  much of the source the run reached, as a tab: by suite, kind and package, and
  below it each source file with the test files that entered it. When coverage
  cannot be counted for a record, the page says so in a chip and still opens;
  the list of entered files needs only the record's covering relation.

Click a test file anywhere and its pane opens: each attempt of its retried cases
with the outcome, time, message and the frame closest to the failure, its phases
and place on the timeline, and the source files its cases entered, each a link
to that file in Coverage. A file in Coverage links back to every test file that
entered it.

## Open it

```bash
variance view
```

The command reads the record, writes `variance-view.html` in the variance cache
directory, and prints the path. `--out <file>` writes elsewhere, and
`--suite <name>` reads the record of one declared suite when the repository has
more than one. Opening the file is yours: the command starts no browser.

## Addresses

The address is the page's position: `#tests`, `#timeline` or `#coverage`;
`#<tab>/<needle>` opens a tab with the needle in its filter and its row marked;
`#test/<file>` opens one test file's pane, which has no tab of its own.

## Limits

- Every list is cut to its first hundred rows by the command, so the page stays
  a size a browser opens at once; the filter searches those rows only.
- Cases sit in recorded order inside a file's bar, not at their real start,
  as in [the trace](trace.md#what-a-trace-shows-and-what-it-does-not).
- A record made before Playwright carried starts has no Timeline.
- A pane exists only for the test files the page holds a row for.
