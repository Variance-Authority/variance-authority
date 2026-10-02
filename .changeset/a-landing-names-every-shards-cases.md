---
'@variance-authority/sense': patch
---

A landing names every case its shards ran as the last run

After `variance journeys --suite` (or `landCases`) lands several shards of one
run, the record's last-run layer names the cases every shard recorded. It named
only the last shard's, so `variance covering --cases last` on a landed record
answered from that shard alone. A case a later shard retired is not named.
