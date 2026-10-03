---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

Every shard of a landing is compared with the base, and a module cut from another text is unmeasured

When `variance journeys --suite` (or `landCases`) lands several shards at one
commit, every shard's before layer is now cut from the case index the landing
began with. A later shard's was cut from the index the earlier shards had
already laid, where the modules they recorded stand at the new text. The layer
was still named at the base commit, so `variance review` and `covering --cases
last` paired those rows through the diff onto the wrong regions, and reported
cases that had not moved as lost.

The record's last-run layer now names the text each before module was cut from
(`beforeTexts`). A module whose text at the base commit is another one is not
compared, and the motion lists it as `Not compared, the cases before were
recorded over another text than <commit> holds`. A record written before this
names no texts, and is compared as it was.
