---
'@variance-authority/sense': patch
---

`variance ask search` and `ask symbol` now find a declaration by its name, or
by the words of its doc comment, without reading every file. The source index
now stores each declaration's name and the words of its doc comment. On Kibana,
finding the declarations for `ask search --query mount` drops from 1.8 s to
0.14 s.

A doc comment now matches even when its file has been deleted since the last
`variance index`. An index written by an earlier version is built again on
first use.
