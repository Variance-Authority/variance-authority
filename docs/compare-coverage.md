# Compare coverage services

You probably report coverage already, with Codecov, Coveralls, or a CI step
that prints the Istanbul or c8 summary. Those tools report how many lines ran,
**added up over the whole suite**. So they cannot tell you which test ran a
line, whether a line runs only under your end-to-end tests, or why the number
fell on this pull request. [Variance Authority](README.md) counts the same
kind of number from a record that keeps **which test ran each part of each
module**, so the answer to all three is in the report:

```text
coverage at 7556a03a against each suite's base — 4,812 regions (4,790 at the base) in 311 files the suites loaded
  any suite           4,356  90.5%                                                                  over this text; ran in any text 4,310 → 4,356 (90.0% → 90.5%): 0 over an older text
    checkout  e2e     3,900  81.0%  +51 newly run · −2 no longer run · +19 run in 22 added regions  over this text; ran in any text 3,832 → 3,900 (80.0% → 81.0%): 0 over an older text
    stories   visual  718    14.9%  −716 no longer run · −3 no longer run after a case stopped      over this text; ran in any text 1,437 → 718 (30.0% → 14.9%): 0 over an older text
    unit      unit    3,352  69.7%  +4 newly run · −9 no longer run · +4 run in 22 added regions    over this text; ran in any text 3,353 → 3,352 (70.0% → 69.7%): 0 over an older text
  stories: src/checkout.stories.tsx no longer runs 212 functions in 9 files (716 regions) at the base
  unit: src/checkout/total.test.ts no longer runs total in src/checkout/total.ts (3 regions) at the base
```

A coverage service shows the visual suite's line as `-15.1%`. This report shows
that one story file stopped running 716 regions, and that nothing was deleted.

## What a coverage service stores

LCOV, Cobertura and V8's coverage output all store a count for each line: how
many times it ran, over every test that ran. Adding the counts up is what keeps
a coverage report small. It also removes the test from the data, and nothing
downstream can put it back.

Codecov separates kinds of test with
[flags](https://docs.codecov.com/docs/flags). You upload each suite's report
with `-F <flag>`, and each flag gets its own percentage, in the pull request
comment and in its history. Carryforward keeps a flag's last report for a
commit that did not run that suite. That gives you one percentage per suite,
and it leaves three questions without an answer:

- **Which test ran this line.** Each flag's report is still a count per line.
- **Which lines only one kind of suite runs.** Two percentages cannot be
  intersected. To know that a line runs under end-to-end tests and under no
  unit test, you need the set of suites for each line. Separate totals do not
  keep that set.
- **Why a number changed.** The change is one total subtracted from another. A
  test that stopped running code, a deleted file, and new code that other
  suites run all look the same.

## Why per-test coverage is rare

The data that answers those questions is tests × lines, and coverage tools do
not store it, for three reasons:

- **Size.** At 200,000 modules and 2,000 test files, the relation has 671
  million entries: 2,685 MB as four-byte pairs. The
  [execution record](execution-record.md) keeps the same relation in 132 MB,
  because a test that imports a barrel file covers every module under it, and
  all those modules share one set of tests.
  [Addressing scale](scale.md#the-execution-record) shows the arithmetic.
- **Isolation.** The usual way to know what one test ran is to reset the
  counters around it, in a fresh process or with `Profiler.takePreciseCoverage`
  per test. That changes how the suite runs, and it costs time for every test.
  The record reads what each case ran from the test run you already have. It
  starts no process and no browser per test.
- **Browsers and services.** V8 coverage comes from Node or from Chromium, as
  byte ranges over the built script, mapped back through source maps. A
  Storybook story, a Playwright page and the service the page calls produce
  separate reports that are never joined. The record gives each run of a
  subject one id, and an instrumented Node service reads that id off the
  requests the page sends and reports what it ran under it, so the page and
  the service it called are counted as one
  [journey](journeys.md).

Codecov built per-test selection once:
[Automated Test Selection](https://about.codecov.io/smart-automated-test-selection/),
an open beta for Python and pytest that uploaded per-test labels. Sentry's
[Codecov year in review](https://sentry.design/blog/codecov-2024), published in
December 2024, describes it as shelved because of time and technical
difficulty.

## What `variance coverage` reports

The record exists because [test selection](selecting.md) needs it: a changed
line can only skip a test if the record shows that test never ran the line. The
coverage numbers are counted from that record, so they need no second
instrument and no second run.

| Question | Coverage service | `variance coverage` |
|---|---|---|
| Share of the code each suite runs | one upload per flag | one count per [declared suite](execution-record.md#one-record-for-each-suite), all over the same total |
| Code that only one kind of suite runs | no answer | counted per kind: unit, integration, e2e, visual |
| Code only another package's tests run | no answer | counted per package by [whose tests ran it](own-fewer-tests.md#ask-which-code-only-distant-tests-run), and walked down to the files only another package's tests reach |
| Code that only ran on the way to something else | no answer | counted per suite as [accidental](own-fewer-tests.md#earned-and-accidental-coverage): run by some test, never by its own package's tests within one import hop |
| Code reached only from far away | no answer | counted by the import hops of the nearest test that ran it, with [`--at-distance`](own-fewer-tests.md#ask-which-code-only-distant-tests-run) |
| Why a suite's number changed | the difference of two totals | regions newly run, no longer run, added and removed, which add up to the change; a region whose test has not run since its file changed is counted as unmeasured, not as no longer run |
| Code whose tests ran an older text | counted as run | left out of the figure each row leads with and counted apart, per suite, scope and [package](own-fewer-tests.md#ask-what-still-holds-since-the-code-changed): run over an older text when every test that ran a region ran it before an edit that touched it, and not known, with the reason, when the text a test ran cannot be found |
| Which test file accounts for it | no answer | named |
| Files no test ran | at 0%, when the reporter is told to include every file under a glob | listed with their lines and regions, within the application `--from` names, following its imports into shared packages |
| A suite that has not run | the last report, carried forward | `unrecorded`, never `0%` |

The base for each suite is the record your mainline published to the
[share](sharing.md). Its regions are paired with yours through git's diff from
the commit it was recorded at, so your clone needs that commit: without it,
`variance coverage` exits `2` and names the commit to fetch, rather than
comparing regions that may not be the same code. [The CLI reference](../packages/cli/README.md#coverage-how-much-each-kind-of-suite-runs-and-what-changed-it)
describes every line of the output.

## What it does not replace

- **A different number.** The unit is the region, a function, branch or run
  of statements with no decision in it, and a region counts as run only when a
  test called into it. Code that runs only while its module loads is counted
  on its own line. The percentage is lower than the line coverage Istanbul
  prints for the same suite, so compare each number with its own history, not
  with the other tool.
- **Run is not checked.** A region run by six tests that assert nothing about
  it has six tests and no evidence.
  [On testing](on-testing.md#coverage-opens-the-question-it-does-not-close-it)
  covers what coverage can and cannot tell you about a suite.
- **No hosted dashboard.** There are no badges, no hosted history and no
  service to log in to. The share keeps one record for each branch, so the
  report compares a pull request with its mainline and does not draw a trend.
  If your team reads Codecov's dashboards, keep uploading to it.
- **No gate.** `variance coverage` exits `0` whatever the numbers are. A
  threshold is a line in your own workflow.

## Run it beside the service you have

Nothing here replaces the upload step. Declare your suites in the root
`variance.config.json`, run them with the recorder, and print the table into
the job summary after the suite:

```bash
npx variance coverage --format markdown >> "$GITHUB_STEP_SUMMARY"
```

[Choose how tests are selected](coverage-test-selection.md) covers the record
from the test selection side, and [compare with the tool you already
have](comparison.md) covers the other tools this project overlaps with.
