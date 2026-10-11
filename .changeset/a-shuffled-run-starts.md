---
"@variance-authority/sense": patch
---

A run wrapped for test selection orders, shuffles and seeds its tests as the
same runner does unwrapped, and prints the seed where the runner prints it, so a
shuffled run can be repeated with its seed.

- **Vitest.** A config wrapped by `withTestSelection` runs under
  `--sequence.shuffle` and `--sequence.shuffle.tests` instead of failing before
  its first test with `TypeError: Inner is not a constructor`. With no sequencer
  of the project's own, a run that shuffles files orders them with Vitest's own
  `shuffle` and the run's seed. `vitest/node` exports no `RandomSequencer` to
  chain. The run picks a seed when none was given, as Vitest does for its own,
  and the banner names it on the line after `RUN`:
  `Running tests with seed "…"`. A reporter that prints no banner prints no
  seed, so `--reporter=json` still writes only its report to stdout. On Vitest 2
  and 3.0, a `--reporter` on the command line replaces the reporter that adds
  the seed to the banner, so the seed is printed on stderr instead:
  `variance-authority: running tests with seed "…"`. From Vitest 3,
  `--sequence.shuffle.files` shuffles files and `--sequence.shuffle.tests` does
  not, as unwrapped. Vitest 2 gives the wrapper neither flag, so it reads both
  as the boolean Vitest turns them into.
- **Jest.** `--randomize` shuffles each kept file's tests in the order Jest
  gives those files alone with the same `--seed`, and the summary prints
  `Seed:` as it does unwrapped.
- **Rstest and Playwright** have no shuffle and no seed, and their wrappers do
  not change the order the runner picks.

In every runner, the selection removes files before the runner orders them. A
shuffled selected run is the run the runner gives the files the selection kept.
