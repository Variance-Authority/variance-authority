---
"@variance-authority/sense": patch
---

`coverage.runs.json` carries `standing`: for each test in the snapshot that the runs at its commit did not observe, the commit it last ran at, oldest first. `landRun` carries it forward from the record it replaces, so after partial runs at two commits a test that neither ran still names the commit before both. A record written before this field reads as every such test standing on `over`. `over` and `files` keep their meaning.
