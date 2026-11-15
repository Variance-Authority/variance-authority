---
'@variance-authority/sense': patch
---

`variance ask symbol` lists the members of an interface or class by looking its
one file up in each layer of the source index, where it merged every file record
of the index first, and looks up the files a member's uses may sit in the same
way. Finding a member's declarations, and the extensions beside them, still
merges the index. On a workspace of 107,000 files, the ten member lookups of
`ask symbol --name mount --just-answer` took about 75 ms and now take under
1 ms. No answer changes.
