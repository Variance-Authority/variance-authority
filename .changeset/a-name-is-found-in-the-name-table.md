---
'@variance-authority/sense': patch
---

`variance ask search` and `ask symbol` now find a declaration by its name, or
by the words of its doc comment, without reading every file. The source index
now stores each declaration's name and the words of its doc comment. On Kibana,
`ask search --query mount` drops from 2.4 s to 1.1 s, the declarations it finds
from 1.8 s to 0.14 s of it. The larger index costs every question about 14 ms
more to open on Kibana, so `ask symbol` on a name with many declarations, which
opens it once per declaration, is about 10% slower.

A doc comment now matches even when its file has been deleted since the last
`variance index`. An index written by an earlier version is built again on
first use.
