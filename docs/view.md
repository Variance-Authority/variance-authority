# View: a recorded test run as one page you open from disk

`variance view` writes one HTML file from the [execution record](execution-record.md)
your last test run left, and prints its path. The page has three tabs: which
test files and cases were slowest and which were retried, where each file sat
on the run's clock, and which suites and packages the run covered. It needs no
server, no network and no account: open the file in a browser.

## What the page shows

- **Tests** lists the slowest test files and the slowest cases, and every case
  that was retried with each attempt, its time and its failure message. Click a
  column header to sort, and type in the filter box to narrow the rows.
- **Timeline** draws each test file as a bar from the moment the runner started
  it, with the phases the runner timed in colour. It is the picture
  [`variance trace`](trace.md) prints as spans, drawn on the page instead of
  sent to a viewer. Only Playwright records a start; a file without one is
  counted in a note and not drawn, because placing it would be an invention.
- **Coverage** is the [coverage report](compare-coverage.md) as a tab: how much
  of the source the run reached, by suite, kind and package. When coverage
  cannot be counted for a recording, the page says so in a chip and still
  opens.

A name in one tab links to its row in another: the address is `#tests`,
`#timeline` or `#coverage`, and `#tests/<needle>` opens a tab with the needle in
its filter and its row marked.

## Open it

```bash
variance view
```

The command reads the nearest recording, writes
`variance-view.html` in the variance cache directory, and prints the path.
`--out <file>` writes elsewhere, and `--suite <name>` reads the record of one
declared suite when the repository has more than one. Opening the file is
yours: the command starts no browser.

## Limits

- Every list is cut to its first hundred rows by the command, so the page stays
  a size a browser opens at once; the filter searches those rows only.
- Cases sit in recorded order inside a file's bar, not at their real start,
  as in [the trace](trace.md#what-a-trace-shows-and-what-it-does-not).
- A recording made before Playwright carried starts has no Timeline.
- The page does not yet draw which test covered which source file.
