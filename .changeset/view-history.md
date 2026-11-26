---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance view` gains a History tab: every record the share keeps of the
mainline in the window, one row per commit and suite with its time, test
files, cases, retried cases and the time their earlier attempts cost; each test
file's mean over the window; every retried case; and the commits whose suite
time moved most, over the test files both runs timed, with the files that
moved it; a record it does not draw is named with why. `--since <n>d` or `<n>w`
sets the window, 14 days by default. Each record is read whole once and its
summary kept in the cache under its digest; a cold read reports its progress
on stderr.

`@variance-authority/sense/test-selection` publishes `costs`, `readableAttempts`
and `retriedAttempts`, the readers the tab builds on.
