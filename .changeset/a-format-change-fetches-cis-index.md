---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

A release that changes the source index's format can start from CI's index

A share takes `sourceIndex`, off by default. When it is `true`, `variance share --suite` on a mainline also publishes the source index CI built, as the entry `source-index-v<format>` beside the record, with each segment as an image. An update over an index a release in another format wrote fetches that index as it starts, while it lists the checkout; the mainline's record never waits for it. The update then reads only the files that differ from it. Every command that updates the index says on stderr when it starts that download, and why it placed none when the share holds no index in this format or it does not check out; `variance index` names the index it fetched. A segment too large to carry as one image, past 2 GiB, leaves the index out of the publish with the reason, and the record is published. `updateSourceIndex` and `publishedSources` take a `fetch` callback for this, and the update's result has the fetched index as `fetched`. `placeSourceIndex`, `fetchedSourceIndexPath`, `sourceIndexChain` and `sourceIndexWrittenIn` are exported. The index is about the size of the parsed checkout: on Firefox, about 200,000 files, it is about 2 GB, or 0.7 GB compressed.
