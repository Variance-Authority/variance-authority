---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance review` says what a change did, after the suite ran it: how each changed module was edited, the changed regions no case covered and those only tests further than one import away covered, the cases added and removed, the changed files the tests declare as preconditions, and the installed packages the lockfile changed. It prints `text`, `markdown` or `json`, and `--out <dir>` also writes `review.json` and `review.md`. The markdown starts with a hidden marker line, so a pipeline edits its own pull request comment instead of posting another.

Every run of the suite now writes `coverage.runs.json` beside the recording: the commit it ran at, the commit the recording stood at before the runs at that commit, and the test files they ran. A retry or a second shard at the same commit keeps that starting point. `variance review` with no `--since` starts there. `commitRunsFile`, `readCommitRuns` and `landRun` read and write it from `@variance-authority/sense/test-selection`, and `testsGovernedBy`, which names the test files that declare a given file as a precondition, is exported beside them.
