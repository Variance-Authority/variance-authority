---
'@variance-authority/cli': minor
---

`variance view` writes a recorded run as one page to open from disk

The page has a Tests tab (slowest files and cases, retried cases with each
attempt), a Timeline tab (files and phases on the runner's clock) and the
Coverage tab, in one self-contained HTML file with no server and no network.
The command prints the file's path and starts no browser.
A test file opens a pane with its attempts, phases and the source files it
entered; Coverage lists the test files that entered each source file.
