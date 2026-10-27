---
'@variance-authority/cli': patch
---

`covering` says how far its record is behind the checkout

`variance covering` paints ranges recorded at one commit onto the checkout at
another, and until now never said how far apart the two were: *written since
the recording* read the same one commit on as two thousand. Every answer read
from a record now names the commit the record was made at and places it
against `HEAD`:

```
The record was made at 1fa19f610e2a, 3 commit(s) before HEAD.
```

In JSON each suite's answer carries `at`, `behind` (the commits `HEAD` holds
that the record does not) and `ahead` (the commits the record holds that `HEAD`
does not), so a record made on another branch is counted both ways. A clone
that does not hold the record's commit, or whose history is too shallow to walk
to it, keeps `at` and leaves both counts out.
