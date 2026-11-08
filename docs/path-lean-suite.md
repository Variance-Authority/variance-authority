# Keep a test suite lean

A suite only grows, and a merged coverage percentage cannot say which tests are
still worth their cost. This path gets you from "a line ran" to which tests ran
it, under which state, and how much of what each test loads it actually uses,
so you can delete, merge or shrink a test on evidence.

[Variance Authority](README.md) records, for each named test case, the regions
of your source it covered, on the suite you already run. This page orders what
you do with that record and links the page that owns each step.

## 1. Record which test covered which line

Ordinary coverage is a union with the names folded out. Test-level coverage
keeps them, so a line answers *which tests walk me* rather than *did anybody*.
Every later step reads this relation.

[Test-level coverage](test-level-coverage.md)

## 2. Record the state each test ran under

Two cases can cover the same line under a different feature flag, a different
mock or a different signed-in user, and that state is the reason each exists. A
[case precondition](case-preconditions.md) records the state the test set up.
A breadcrumb, one `varianceBreadcrumb` call in your source, records the value
the code actually read, so you can see that the scenario a test claims is the
one that ran.

[Record the state each test ran under](case-preconditions.md)

## 3. Find the tests that cover the same thing for the same reason

Point at a line and you get the named cases that walked it. Six cases on one
line under one state are a candidate to own fewer of; six under six states are
not.

[Own fewer tests](own-fewer-tests.md)

## 4. Make the tests you keep cost less

Running only the tests an edit reached cuts how many run, not what one costs.
A test that imports a module pays for loading it on every run, and is picked by
every edit to it, whether or not it calls into it. A test can load far more than
it uses.

[Make one test cost less](optimize-a-test.md), then
[Distil a test to the behavior it witnesses](distill.md) for a test that renders
a whole page to exercise three elements of it.
