# Spec 0071 — a test is read alone

**Missing:** a way to see one test alone in the editor. `covering --cases
last|<test file>` answers from the chosen cases rather than the suite, and with
`last` says what moved against the cases the run replaced. Both editors paint
only the suite's answer.
**Built on:** [0069](0069-the-case-index-layers-each-run.md) (the index names
the cases of the last run, and keeps the layer that run retired),
[0065](0065-the-record-in-webstorm.md) item 2 (*show only this case's lines*),
and [0070](0070-a-change-says-what-its-tests-moved.md) (what moved, per region).

## Purpose

A test read inside the whole suite is read with a bias. Other cases' crossings
cover the lines it misses, so its gaps look walked, and its rows can predate the
edit you just made. Reading it alone removes both biases:

- **Other cases.** The view is the chosen cases' crossings and nothing else.
- **Stale rows.** The view is the last run's, and the run is the one you just
  made, so it describes the test as it is now.

Running alone is the runner's job, not ours. Vitest isolates each test file by
default, so one file's reach does not depend on the files that ran before it.
Within a file, cases share module state, and a case that runs after another can
find a memoized value and skip the code that would compute it. Running one case
(`-t`) is how you remove that last bias, and the runner already offers it. The
suite still reuses one world for speed. Only a request about one test pays for
running it alone.

## What would discharge it

**1. A toggle in each editor.** The status bar item switches the painted view
between *the suite* and *the last run alone*, and says which view is showing.
The per-case popup of 0065 item 2 and its VS Code counterpart set the scope to
one case. A lost region gets its own mark while the focus is on.

## Acceptance

1. Run the whole suite, then run one test file. With the toggle on, the editor
   paints only what that file entered. With it off, it paints the suite's
   answer, unchanged by the partial run.
2. Delete an assertion that was the only path into a branch, and run the file.
   The branch shows as **lost** in the focused view.
