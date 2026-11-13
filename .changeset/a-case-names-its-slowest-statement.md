---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/cli': minor
---

A case records its slowest statement under Vitest, Jest and Rstest: the line of
the test that took longest and its time on the real clock, with a loop's runs
summed and hooks left out. `variance ask slowest-tests` prints it under each
case it lists, with its share of the case. `cadence: false` turns it off, and a
record written before it reads every case as untimed.
