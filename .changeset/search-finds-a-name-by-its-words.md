---
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

`variance ask search` finds a name from the words it is written in

A query of several words matches a name when each word matches one of the
words the name is written in, split at a change of case or between a letter and
a digit, so `kept reading` finds `keptReading` and `parse http response` finds
`parseHTTPResponse`. A search index written before this is encoded again on
the next read.
