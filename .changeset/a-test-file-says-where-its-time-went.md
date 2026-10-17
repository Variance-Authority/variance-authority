---
'@variance-authority/sense': minor
'@variance-authority/distill': minor
'@variance-authority/cli': minor
---

A recording keeps where each test file's time went, and `variance distill` shows it

Beside its duration, each test file now carries the time it spent in five
phases: readying the file in its worker, the test environment, the setup
files, collecting the file — importing it and everything it loads — and its
cases. Vitest reports all five. Under Jest, `perfStats` times the environment
and the setup files, and the setup module marks where collecting ended, so the
rest splits into collect and cases.

`variance distill` over a folder, a suite or the repository sums the phases of
the test files it reads, gives each its share, and names the files whose
loading took over ten times as long as their cases: the files where what a
test imports, not what it checks, is what the run pays for.
