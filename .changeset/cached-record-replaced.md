---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A run or `variance journeys` over a record in the checkout's cache written under
other probes replaces it, stays green and prints one line naming the file and
both sets of probes, so an upgrade no longer fails the first run after it. A
record handed in by `coverageFile` or `--into` is still refused and left byte for
byte. `prepareRecord(lock, root, instrumentation, { alone, cacheRoot })` is the
new export from `@variance-authority/sense/test-selection`: it replaces such a
record and then seeds the checkout's base, and says what it laid, so `noteSeeded`
is no longer exported.

Seeding now runs in the hold the run lands in: `seedTestCoverage` and
`layFetchedMainline` take the `IndexLock` of `withIndexLock` in place of the file,
so a run another writer landed is never copied over. A hold that finds the lock
busy records nothing and says so.
