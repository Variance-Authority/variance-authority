---
'@variance-authority/sense': patch
---

`variance ask symbol` and `ask uses` find the files importing a name from the
imports `variance index` recorded backwards, by the file they import, rather
than by reading every file's imports on every step of the walk. A specifier
that resolved to no file is judged once however many files write it. On
Kibana, `ask symbol --name mount` drops from 1.8 s to 1.2 s, and
`docs_symbol` to a warm help server from 0.9 s to 0.4 s; indexing takes as
long as before. An index written by an earlier version is built again on first
use.
