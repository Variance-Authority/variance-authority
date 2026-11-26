---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`share --publish --from-queue` publishes the pull request's run when the merge queue's run kept no record

A merge queue's run that ran no shard, or failed and was retried, kept no record, and the push that landed its commit published nothing until the whole run finished. The push now reads the latest green `pull_request` run of the same workflow at the landed merge's second parent, the pull request's head. That run tested the head merged with the record's commit, as `carry merge` makes it. Its records are published at the landed commit, marked partial as the queue's are, only when the head merged with the landed merge's first parent is the landed commit's own tree, and when the records name the merge `carry merge` makes of those two commits. A different tree, another merge, no green run or no record publishes nothing, and the line says which. The line `read from pull request run <id>, …` opens a publish that read it.

`restateRecord` in `@variance-authority/sense/test-selection` states a record made at one commit at another commit of the same tree.
