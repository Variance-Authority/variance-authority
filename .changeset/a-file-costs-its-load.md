---
'@variance-authority/sense': patch
'@variance-authority/distill': minor
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

A test file costs what running it took, the time before its first case included

Vitest's file duration is its cases alone, so a file that spent 5.4 s on its
environment, setup files and imports and 33 ms in its cases was ranked and
placed as a 33 ms file. Every reader that weighs a file by its time now reads
one figure: the larger of the runner's duration and the file's phases summed.
A Jest file still costs its runtime unless its phases add up to more, and a
file recorded without phases still costs its duration.

- `variance ask slowest-tests` and `docs_slowest_tests` rank files by it.
- A sharded run, and `variance shards`, place and count files by it.
- `variance distill`'s "loading" is everything before the first case —
  `prepare`, `environment`, `setup` and `collect` — rather than `collect`
  alone, as `timeBeforeCases` from `@variance-authority/sense/test-selection`
  reads it, and a file is load-bound when that outlasts its cases. In
  `--format json`, each `loadBound` entry is `{ file, loading, cases }`; its
  `collect` field is gone.

The stored `tests.duration` is unchanged: it stays the runner's own figure.
