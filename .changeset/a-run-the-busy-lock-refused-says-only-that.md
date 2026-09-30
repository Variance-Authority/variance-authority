---
"@variance-authority/sense": patch
---

A test run refused by a busy snapshot lock prints only that it recorded nothing

When another process keeps `coverage.bin.lock` for the ten seconds a writer waits, the Vitest and Rstest plugins and the Jest reporter write neither the snapshot nor the case index, and print one warning: `variance-authority recorded nothing from this run: another process is holding <file>.lock: nothing was recorded rather than merged over whatever it is writing.` When the snapshot was written and the case index lock beside it is the busy one, they print `variance-authority recorded this run's files, but not its cases: another process is holding <file>.cases.bin.lock, and the cases were dropped rather than merged over whatever it is writing.` The warning that a run instrumented 0 modules, so selection from its snapshot will select nothing, is printed only when the run wrote a snapshot.
