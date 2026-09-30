---
"@variance-authority/sense": minor
---

A worktree's first test run lays the mainline record last fetched on this machine, with its runs record, into its own layer, and falls back to the primary checkout's record only when nothing was fetched. `seedTestCoverage` returns which one it laid and `noteSeeded` prints it. The runner integrations never fetch: `lastFetchedMainline` reads the name a fetch writes last, as `fetched.json` beside `<cache>/share/read/<suite>/`, and `layFetchedMainline` lays what it names. `FETCHED_MAINLINE`, `mainlineReadRoot`, `readFetchedMainline` and `writeFetchedMainline` are exported for a fetcher of your own.
