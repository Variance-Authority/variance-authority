---
"@variance-authority/cli": patch
"@variance-authority/sense": patch
---

`variance journeys <shard>...` now writes `coverage.runs.json` beside the snapshot it lands. Before, it left the record describing the runs before the landing. The fold counts as one run at the shards' commit and follows the same rules as `landRun`. At a new commit, `standing` is carried forward from the record it replaces, and `over` names the commit the snapshot stood at. At the commit the record already names, the fold's test files are added to `files` and `over` is kept. When git says the new commit does not descend from the snapshot's, as when the main line's shards land over a branch's runs, `over` is left out, for `landRun` and the landing alike: a review would otherwise read the branch's change from the branch's own later commit. A runs record the landing cannot parse is refused by name. The record is staged and renamed under the snapshot's lock, like the snapshot. A landing that fails leaves both unchanged. `@variance-authority/sense` exports `commitRunsAfter` and `writeCommitRuns`, the rules and the write `landRun` uses, and the `RecordedTests` type they read.
