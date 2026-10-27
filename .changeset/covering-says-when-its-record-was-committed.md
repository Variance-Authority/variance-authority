---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`variance covering` closes every answer about a file with one sentence on how fresh it is for that file: whether the text you asked about is the one the suite ran over, edited since, gone, off disk, or not digested at all, and the commit the record was made at with how long ago it was committed. A count of commits since the record is not given, because a commit to other code says nothing about this file.

```
src/pay.ts differs from the text the suite ran over at 1fa19f610e2a, committed 3 days ago; its lines are placed in the text as it is now.
```

In JSON every answer whose record names a commit carries `at`, and `committedAt` when the clone holds that commit. `frame` is on `--function` answers too, and `unheld: true` marks a file that is not on disk. The `--since` reading dates its record the same way. Under a `stale` frame `--function` no longer lists the parts no case ran, since no recorded line is a place in the text you hold. `@variance-authority/sense` exports `committedAt`, the committer time of a commit the clone holds, and `ranOver`, the clause that dates a record.
