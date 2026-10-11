---
"@variance-authority/sense": patch
---

A Vitest config wrapped by `withTestSelection` runs under `--sequence.shuffle`
and `--sequence.shuffle.tests` instead of failing before its first test with
`TypeError: Inner is not a constructor`, and shuffles its files under
`--sequence.shuffle.files`, which ran them unshuffled. A shuffled run prints its
seed so you can run it again in the same order: in the banner on the line after
`RUN`, where Vitest prints its own. On Vitest 2 and 3.0, a `--reporter` named on
the command line leaves the seed out of the banner, and the run prints it on
stderr instead: `variance-authority: running tests with seed "…";
--sequence.seed=… runs them in this order again`.
