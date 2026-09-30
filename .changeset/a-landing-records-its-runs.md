---
"@variance-authority/cli": patch
"@variance-authority/sense": patch
---

`variance journeys <shard>...` now writes `coverage.runs.json` beside the snapshot it lands. Before, it left the record describing the runs before the landing. The fold counts as one run at the shards' commit and follows the same rules as `landRun`. At a new commit, `over` names the commit the snapshot stood at, and `standing` is carried forward from the record it replaces. At the commit the record already names, the fold's test files are added to `files` and `over` is kept. The record is staged and renamed under the snapshot's lock, like the snapshot. A landing that fails leaves both unchanged. `@variance-authority/sense` exports `commitRunsAfter` and `writeCommitRuns`, the rules and the write `landRun` uses, and the `RecordedTests` type they read.
