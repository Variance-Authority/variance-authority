---
'@variance-authority/cli': patch
---

`covering` says how far its record is behind the checkout

`variance covering` paints ranges recorded at one commit onto the checkout at
another, and until now never said how far apart the two were: *written since
the recording* read the same one commit on as two thousand. Every answer read
from a record now names the commit the record was made at and how many commits
`HEAD` is past it, in the words `review` uses for the mainline's record:

```
The record was made at 1fa19f610e2a, 3 commit(s) behind HEAD.
```

In JSON each suite's answer carries `at` and `distance`. A clone that cannot
count the two apart keeps `at`, leaves `distance` out and says the distance
cannot be counted.
