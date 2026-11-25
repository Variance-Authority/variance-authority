---
'@variance-authority/cli': minor
---

`variance view` writes a recorded run as one page to open from disk

The page has a Tests tab (slowest files and cases, retried cases with each
attempt), a Timeline tab (files and phases on the runner's clock) and the
Coverage tab, in one self-contained HTML file with no server and no network.
The command prints the file's path and starts no browser.
