---
'@variance-authority/sense': minor
---

A case recorded again over the code it read before keeps its earlier readings in the record, in a `cases.readings` section: each distinct reading once, with how many runs read it so, up to 16. A reading is what the case crossed, the test line each region was charged to, and whether it stopped. A module either reading entered at another text drops them. `combineRecords` folds each shard's readings into the combined record and refuses a case two shards read differently. Selection reads nothing new.
