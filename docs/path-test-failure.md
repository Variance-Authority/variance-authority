# Find out why a test failed or hangs

A failed assertion says *that* something went wrong; this path finds *where*.
Read what the run kept about the test, then the order it ran its code in, then
where its path left a passing one's. A run that has not ended, because a test
hangs, starts at step 4: watch it and stop it where it stands.

[Variance Authority](README.md) keeps one test's work, across every process it
touched, after the run ends, and can show it while the run is still going. This
page orders the steps and links the page that owns each one.

## 1. See what the run kept about the test

A suite whose config is wrapped with `withTestSelection` already recorded,
for the failed run, which code each test ran. One index lists every reading the
run kept, from the moment your runner starts the test to the moment it ends, so
you pick the one your question needs.

[Understand an execution](understand-execution.md)

## 2. Read what the test ran, in order

A test story writes out each function the test ran, the branch it took at each
`if`, how many times each loop ran and the values each function was handed. It
is not kept by default: run the failing test again with
`VARIANCE_AUTHORITY_STORY=1`. When a test fails only on some runs, stories of
passing and failing runs side by side show where they part.

[Read what one test ran, in order](test-stories.md)

## 3. Find where its path differs from a test that passes

When a neighbouring test passes over the same file, compare their paths. Three
tests can load the same file with the same props and walk different code in it.
The path an execution took shows the region one test entered and the others
never did.

[The path an execution took](journeys.md)

## 4. Watch a run that has not finished

A test that has sat on one line too long has not written anything yet.
[Vantage](vantage.md) shows, while a Playwright suite is still running, what
each test's application code has announced, and which work it started and never
finished.

[Watch a run that has not finished](vantage.md), and
[Inspect a suite while it is running](agent-live-run.md) to read it from a
shell or an MCP client.

## 5. Stop the test where it stands

A failure that will not reproduce by hand is visible only while the test is
still in it. Stop a Playwright test at a line you choose and look at the page
and its network from another shell.

[Interrogate a test where it stands](agent-interrogate.md)
