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
directory, and prints the path. `--out <file>` writes elsewhere, and
`--suite <name>` reads the record of one declared suite when the repository has
more than one. Opening the file is yours: the command starts no browser. With no record yet,
[make one first](#if-you-have-no-record-yet).

## What you see first

The header names the suite, the commit and the record the page was read from,
and counts the files recorded and the files placed on the clock. Below it sit
three tabs, **Tests**, **Timeline** and **Coverage**, with Tests open: the
slowest test files and the slowest cases as sortable tables, each row a link,
above a filter box, then every retried case with each attempt. The Timeline is
a chart with one lane per test file; Coverage is how much of the source the run executed.

## What each tab shows

- **Tests** lists the slowest test files and the slowest cases, and every case
  that was retried with each attempt, its time and its failure message. Click a
  column header to sort, and type in the filter box to narrow the rows.
- **Timeline** draws each test file as a bar from the moment the runner started
  it, with the phases the runner timed in colour: `prepare`, `environment`,
  `setup`, `collect` and `cases`. It is the picture [`variance trace`](trace.md)
  prints as spans for a trace viewer, drawn on the page. A file without a start
  is counted in a note and not drawn, because placing it would be an invention.
  Only Playwright records a start today; Tests and Coverage read what any of
  Vitest, Jest, Rstest and Playwright records.
- **Coverage** shows how much of your source code the run executed, split by
  suite, kind of test and package, and below that each source file with the test
  files that ran it. When the run cannot be counted that way, the page says so
  in a chip and still opens; the list of which test files ran which source file
  needs only the record.

Click a test file anywhere and its pane opens, with these headings:
**Attempts** for its retried cases, **Phases and place** on the timeline, and
**Source files reached**, each a link to that file in Coverage. A file in
Coverage links back to the test files that ran it.

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
- Cases sit in recorded order inside a file's bar, not at their real start,
  as in [the trace](trace.md#what-a-trace-shows-and-what-it-does-not).
- A record made before Playwright carried starts has no Timeline.
- A pane exists only for the test files the page holds a row for.

## Reference: addresses

Read this to share a link to one test, or to open the page at a filtered view.

The address is the page's position: `#tests`, `#timeline` or `#coverage`;
`#<tab>/<needle>` opens a tab with the needle in its filter and its row marked;
`#test/<file>` opens one test file's pane, which has no tab of its own.
