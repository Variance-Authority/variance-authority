---
'@variance-authority/cli': minor
---

`variance view` writes a recorded run as one page to open from disk

The page has a Tests tab (slowest files and cases, retried cases with each
attempt, with a failure's nearest source frame as `path:line` where the record holds one), a Timeline tab (files and phases on the runner's clock) and a
Coverage tab, in one self-contained HTML file with no server and no network.
The command prints the file's path and starts no browser. A test file opens a
pane with its attempts, phases and the source files it called into; Coverage
lists, for each source file, the test files that called into it.

Picking an entered source file in Coverage draws its text with each recorded
range in the state `variance covering` gives it. The page embeds at most 30
files of up to 100 kB each, the most entered first; a file the record lacks or
one with no range states says so.

`variance coverage --format html` now shows its views as tabs with a filter
that narrows the rows and opens the packages that hold a match.
