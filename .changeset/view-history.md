---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance view` gains a History tab: every record the share keeps of the
mainline in the window, one row per commit and suite with its time, test
files, the source files its tests reached, cases, retried cases and the time their earlier attempts cost; each test
file's mean over the window; every retried case; and the commits whose suite
time moved most, over the test files both runs timed, with the files that
moved it, each commit measured from the one before it on the mainline's
first-parent history, and none measured across a record it could not read; a
suite time is drawn only where every file was timed; a record it does not draw is named with why, and a
commit the clone's fetched mainline does not reach is drawn and said to move
nothing. `--since <n>d` or `<n>w`
sets the window, 14 days by default. Each record is read whole once and its
summary kept in the cache, so a second open of the same commits fetches
nothing but the share's listing; a cold read reports its progress on stderr,
and `prune-cache` clears a summary not opened for 14 days.

`@variance-authority/sense` publishes `retriedIn`, a record's retried cases
with every attempt, and `fileTimes`, each test file's recorded time, the one
`recordedTimes` reads; `@variance-authority/sense/test-selection` publishes
`pool`, the bounded worker pool the tab reads the share through.
