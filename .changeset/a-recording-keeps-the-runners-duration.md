---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
'@variance-authority/help': minor
---

A test-selection recording keeps each test file's duration as its runner reported it

The coverage file gains a `tests.duration` column: the whole milliseconds Vitest, Jest or Rstest reported for the file, or the `duration` you pass to `startRecording().finish()`. A file the runner reported nothing for has no duration, never zero. Recordings written before this open with every duration absent. `variance ask slowest-tests [--limit <n>]` (`docs_slowest_tests`) lists the files the latest recorded run spent longest in, and `recordedDurations` in `@variance-authority/sense` is the reading behind it.
