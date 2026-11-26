---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
'@variance-authority/help': minor
---

Each timed statement records what surrounded it as it ended

Beside a statement's time, a cut case under Vitest, Jest or Rstest now keeps
the machine's 1-minute load average and free memory, the test process's
resident memory, and the nodes the statement added to a jsdom or happy-dom
page. A figure the realm cannot read is absent, never 0: Windows reports no
load average, and a realm without a page adds no nodes. `variance story`
prints them under each statement it explains from the record, and `variance
ask slowest-tests` beside the slowest statement of each case, as `as it ended:
load 16.25, RSS 300 MiB, 0 MiB free, 31 nodes added`. Each is one reading, and
nothing selects, caches or judges a test by it.
