# Compare with the tool you already have

[Variance Authority](README.md) keeps a record of what your code did: which
tests ran which parts of which modules, what each captured UI state painted,
and which component and source file drew each part of it. Several kinds of
tool you may already run answer one of those questions, each from its own
data. This page sends you to the comparison for the tool you have, and each
of those pages ends with how to run Variance Authority beside it.

| You already run | For example | What is different here | Compared in |
|---|---|---|---|
| Visual review | Playwright's `toHaveScreenshot`, Percy, Chromatic, Argos, Applitools | A changed picture is traced to the component and the file that painted it, and you operate the renderer and the storage yourself. | [Choose a visual review operating model](compare-visual-review.md) |
| Test selection | `jest --changedSince`, `vitest --changed`, `nx affected`, Datadog Test Impact Analysis, Teamscale, pytest-testmon | A changed line selects the tests that ran that part of the file, not every test that imports it. | [Coverage-based test selection](coverage-test-selection.md#the-idea-is-old) |
| Coverage reporting | Codecov, Coveralls, Istanbul, c8 | Each suite's coverage is counted by kind over one total, with the code only one kind runs, and a change in the number is broken down into the regions that changed it. | [Compare coverage services](compare-coverage.md) |

The three rows read one record. A test run that records for test selection also
gives you the coverage numbers, and a captured UI state that is compared for
visual review also records which code ran while it was painted. You can adopt
one row and leave the others to the tools you have.
