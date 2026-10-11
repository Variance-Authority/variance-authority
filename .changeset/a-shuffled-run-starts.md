---
"@variance-authority/sense": patch
---

A Vitest config wrapped by `withTestSelection` runs under `--sequence.shuffle`
and `--sequence.shuffle.tests` instead of failing before its first test with
`TypeError: Inner is not a constructor`. With no sequencer of the project's own,
a run that shuffles files chains Vitest's `BaseSequencer` and orders the files
with Vitest's own `shuffle` and the run's seed, so a seed gives the same file
order it gives without the wrapper. `vitest/node` exports no `RandomSequencer`
to chain. As Vitest does for its own, the run picks a seed when none was given
and its banner names it on the line after `RUN`, `Running tests with seed "…"`,
so passing that seed back reproduces the file order. A reporter that prints no banner
prints no seed, so `--reporter=json` still writes only its report to stdout.
