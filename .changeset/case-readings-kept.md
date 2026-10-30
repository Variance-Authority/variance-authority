---
'@variance-authority/sense': minor
---

A case recorded again over the code it read before keeps its earlier readings in the record, in a `cases.readings` section: each distinct reading once, with how many runs read it so, up to 16. A reading is what the case crossed, the test line each region was charged to, and whether it stopped. A case read alike on every run keeps its count. The section also keeps what each test file ran over: the text of every module it entered or loaded, and its preconditions. A run of the file over other inputs, or over a module either reading entered at another text, drops its readings, and a case a shard carried from its seed without running keeps them as they were. `combineRecords` folds each shard's readings and inputs into the combined record and refuses a case, or a test file's inputs, two shards hold differently. Selection reads nothing new.
