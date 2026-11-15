---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/cli': minor
---

A case times its statements under Vitest, Jest and Rstest: every line of the
test its body ran keeps its time in microseconds on the real clock, with a
loop's runs summed and hooks left out. `variance ask slowest-tests` prints the
slowest of them under each case it lists, with its share of the case.
`cadence: false` turns it off, and a record written before it reads every case
as untimed.
