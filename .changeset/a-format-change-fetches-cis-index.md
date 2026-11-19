---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

A release that changes the source index's format can start from CI's index

A share takes `sourceIndex`, off by default. When it is `true`, `variance share --suite` on a mainline also publishes the source index CI built, as the entry `source-index-v<format>` beside the record, with each segment as an image. A checkout whose index a release in another format wrote fetches that index while it fetches the mainline's record, without delaying the record. The next update then reads only the files that differ from it. `variance index` names the index it fetched. `updateSourceIndex` and `publishedSources` take a `restore` callback for this, and the update's result has the fetched index as `fetched`. `restoreSourceIndex`, `sourceIndexChain` and `sourceIndexWrittenIn` are exported. The index is about the size of the parsed checkout: on Firefox, about 200,000 files, it is about 2 GB, or 0.7 GB compressed.
