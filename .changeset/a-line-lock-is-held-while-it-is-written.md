---
'@variance-authority/store': patch
---

A directory line's lock stays its writer's for as long as the writer works

A publish to a directory line keeps its lock fresh while it writes, so a write
that runs past a minute is no longer taken for a dead writer's and written over.
A writer that stalls for 30 s or more gives its lock up before another writer
could take it for dead: it writes no manifest and answers that the line moved,
so the publish reads the line again. The same holds for a writer whose lock is
gone, or whose freshening landed too late to count. When two writers find one dead
writer's lock, one removes it and the other waits for the lock that writer
makes.

A dead writer's lock, or a dead writer's claim on one, that the file system will
not let a writer claim or remove, and a lock whose age it will not tell, now
answer as `refused` (or `unreachable`) at once, with what the file system said,
instead of retrying without a pause or waiting the lock out as if it were held.
A writer that gives its lock up because the file system refused to freshen it
answers the same way, instead of that the line moved.
