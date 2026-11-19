---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
'@variance-authority/core': minor
'@variance-authority/store': patch
---

A release that changes the source index's format can start from CI's index

A share takes `sourceIndex`, off by default. When it is `true`, `variance share --suite` on a mainline also publishes the source index CI built, as the entry `source-index-v<format>` beside the record, each segment cut into pieces of 32 MiB that are the entry's images. The share stores an image once, so a commit sends only the pieces no commit before it sent: the segments its update wrote. The names of a segment's pieces are kept beside the index, so a commit hashes only the segments its update wrote too: on Firefox, a commit after the first carries its index in 3 ms rather than 0.8 s. No segment is too large to publish. An update over an index a release in another format wrote fetches that index as it starts, while it lists the checkout; the mainline's record never waits for it, and when another checkout's index of this release opens, the update starts from that one and drops the download without waiting for it, even when the share never answers. The update then reads only the files that differ from it. Every command that updates the index says on stderr when it starts that download, and why it placed none when the share holds no index in this format or it does not check out; `variance index` names the index it fetched. `updateSourceIndex` and `publishedSources` take a `fetch` callback for this, and the update's result has the fetched index as `fetched`. `carriedSourceIndex`, `placeSourceIndex`, `SOURCE_INDEX_PIECE`, `fetchedSourceIndexPath`, `processAlive`, `sourceIndexChain` and `sourceIndexWrittenIn` are exported; `fetch` is given a `signal` that aborts when another checkout's index fits. The index is about the size of the parsed checkout: on Firefox, about 200,000 files, it is about 2 GB, or 0.7 GB compressed.

A `LineCell` says with `imagesShared` that an image stored for one line is there for every line, as the directory, HTTP and memory cells do; a mainline's commit is then kept without its images sent again.
