---
"@variance-authority/cli": patch
"@variance-authority/sense": minor
---

`variance journeys` lands each shard's case index with its snapshot

`variance journeys`, given shard snapshots, merges them into the record this checkout reads, which is landing them. It now also merges the `<coverageFile>.cases.bin` beside each shard into the case index beside the landed snapshot, replacing the cases of every test file that shard ran to the end, and `covering`, `coverage` and `review` answer from the result. The landing prints `cases of N snapshots laid over <index>`. A shard that ran a test file to the end with no case index beside it removes the index, and the landing says why. When another process holds the record's lock, nothing is written and `journeys` exits non-zero with `nothing landed at <path>: another process is holding <file>.lock. Land again once that run ends.`

`@variance-authority/sense/test-selection` exports `landCaseIndexes` and `withIndexLock`, the two a landing of your own needs to write the snapshot and its case index under one lock. The Storybook and Playwright recorders merge a run's cases into the case index rather than replacing it. When another process holds the case index lock, they keep the snapshot they wrote and print `variance-authority recorded this run's files, but not its cases: …`. Every reader opens the case index beside the snapshot it reads.
