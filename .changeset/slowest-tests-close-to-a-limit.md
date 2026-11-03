---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/playwright-test': patch
'@variance-authority/sense': patch
---

`variance ask slowest-tests` now says who is close to a limit. Each suite's
answer opens with the record it read: whose it is, at which commit, how old. Then
come the cases closest to their limit, each as its run and its limit, so 4.9 s of
5 s stands above 40 s of 60 s, and then the slowest files and cases. `--over 3s`
keeps the cases that ran at least that long, and `--from` and `--to` narrow all
of it. The record gains a `tests.limit` column, written by the harness under
Vitest, Jest, Rstest and Playwright, and `startRecording().finish()` takes a
case's `limit` from any other runner. A record from before the column lists its
cases by time alone and says so.
